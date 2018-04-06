/**
 * @module azure-easy-auth-local.js
 *
 * This auth middleware is only used to support development on the localhost.
 * When deployed, the /.auth endpoints, such as /.auth/me and /.auth/refresh,
 * are handled by Azure App Service Authorization and Authentication and this
 * module is never used. However, during development, your web app is running
 * locally from your Express API but still needs to access these endpoints to
 * get the access token for API authenticatio. But it cannot because they are
 * blocked by CORS policies built into the browser.
 *
 * Instead of running the browser with security disabled (easy in Chrome but
 * not so easy with Edge), we create a "fake" /.auth/* endpoint. The web app
 * can access these and thinks that it is accessing the real thing because
 * they are host-relative URLs. This middleware intercepts those requests and
 * redirects them to this same app running in Azure but to the non-dotted
 * versions of those same endpoints.
 *
 * Since the App Service framework has set the cookies, they will be sent to
 * this middleware function, which then proxies them to the real endpoints.
 * The data is then returned to the web app which thinks it succeeded and
 * doesn't know it is running on the localhost.
 *
 * A valid question at this point is, why not just configure the allowed CORS
 * origins using the Azure portal? The answer is that this feature only sets
 * the Access-Control-Allow-Origin header and does not set the other required
 * header, Access-Control-Allow-Credentials. This header must be set to true
 * for the browser to send the AppServiceAuthSession cookie, authenticating
 * the web app. The only work-around, until Azure allows this to be set, is
 * to send these headers ourselves on endpoints we control, namely the ones
 * provided by this middleware: /auth/me and /auth/refresh (without the dot).
 *
 * The flow, during development, is this:
 *   1. The web app, running on the localhost, sends a GET /.auth/me request.
 *   2. The server, also, running on the localhost, responds to the request
 *      and redirects the browser to the https://<azure-host>/auth/me endpoint.
 *   3. This endpoint uses the cookie and makes the same request to the real
 *      https://<azure-host>/.auth/me endpoint. The data, along with the
 *      required CORS headers, is returned to the application.
 *
 * For this to work as designed, the app, with this middleware in place, must
 * already have been deployed to Azure. Note that this works the same for the
 * /.auth/refresh endpoint.
 *
 * Now the redirect from the fake endpoints to the stub endpoints, which
 * proxies them to the real endpoints, will work. Again, this is only to
 * support localhost development, but that is critical versus redeploying
 * to Azure for every source code change that could (and should) be tested
 * locally before committing to the source code repository for deployment.
 *
 * @author Frank Hellwig <frank.hellwig@buchanan-edwards.com
 * @license MIT
 * @copyright 2018 Buchanan & Edwards, Inc. All rights reserved.
 */

'use strict';

const axios = require('axios');

const APPLICATION_JSON = 'application/json';
const APP_SERVICE_AUTH_SESSION = 'AppServiceAuthSession';

const DEV_MODE_ERR_MSG = `\
It looks like you are in development mode and are probably running on your \
localhost. You must first sign into your Azure web site so the appropriate \
cookies are set. In production mode, when running on Azure, you would have \
automatically been redirected to the login page.`;

/**
 * Proxies the request to the host with the auth session cookie.
 * For example, GET /auth/me (without the initial .) is proxied
 * to GET http://{host}/.auth/me (with the initial .), the real
 * Azure endpoint that can handle the request.
 */
function proxyRequest(req, host) {
  const session = req.cookies[APP_SERVICE_AUTH_SESSION];
  if (!session) {
    const err = new Error(`No ${APP_SERVICE_AUTH_SESSION} cookie in request.`);
    err.code = 400;
    return Promise.reject(err);
  }
  const url = `https://${host}/.${req.url.substr(1)}`;
  return axios({
    method: 'GET',
    url: url,
    headers: {
      Accept: APPLICATION_JSON,
      Cookie: `${APP_SERVICE_AUTH_SESSION}=${session}`
    }
  })
    .then(response => {
      return response.data;
    })
    .catch(err => {
      const code = err.response ? err.response.status : 500;
      // Assume that all redirects are redirects to the Microsoft login page.
      // Turn these into 401 responses so that they can be handled using XHR.
      if (code === 302) {
        code = 401;
        err.message = DEV_MODE_ERR_MSG;
      }
      err = new Error(err.message);
      err.code = code;
      return Promise.reject(err);
    });
}

/**
 * Adds the CORS headers that allow access by the local host.
 */
function corsHeaders(res, port) {
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Origin', `http://localhost:${port}`);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

/**
 * Returns a middleware function that will proxy requests to the
 * specified host.
 */
function middleware(azureHost, localPort) {
  return function(req, res, next) {
    const { method, url } = req;
    if (method === 'GET') {
      if (url.startsWith('/.auth/')) {
        res.redirect(302, `https://${azureHost}/${url.substr(2)}`);
      } else if (url.startsWith('/auth/')) {
        proxyRequest(req, azureHost)
          .then(data => {
            corsHeaders(res, localPort);
            res.json(data);
          })
          .catch(err => {
            next(err);
          });
      } else {
        next();
      }
    } else if (method === 'OPTIONS' && url.startsWith('/auth/')) {
      corsHeaders(res, localPort);
      res.status(204);
      res.set('Content-Length', '0');
      res.end();
    } else {
      next();
    }
  };
}

module.exports = middleware;
