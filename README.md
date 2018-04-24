# azure-easy-auth-local

Express middleware enabling Azure Easy Auth locally during development and testing.

Version 1.0.5

# Overview

This is an Express middleware module that enables the local development and debugging of applications deployed to Azure and secured with the App Service Authentication / Authorization feature, also known as *Easy Auth*. It lets you have all of the Easy Auth features available to you locally, while working on your development machine, without having to constantly deploy your application to Azure.

# Installation

```bash
npm install --save azure-easy-auth-local
```

```javascript
const express = require('express');
const authLocal = require('azure-easy-auth-local');

// The following two constants could be in your configuration file.
const azureHost = 'myapp.azurewebsites.net';
const localPort = 45608;

// This is only an example. Your app would have additional endpoints.
const app = express();

app.use(authLocal(azureHost, localPort));

// Listen on either a pipe (once deployed) or a port (localhost).
app.listen(process.env.PORT || localPort);
```

# Web Application

In your web application, you can get the access token and the user's claims using the `/.auth/me` endpoint (provided by Easy Auth). If the token has expired, you can refresh it using the `/.auth/refresh` endpoint. If you are not yet signed in, Easy Auth will redirect you to the federated login page. Once signed in, your browser will have an `AppServiceAuthSession` cookie that these endpoints will use to authenticate you.

```javascript
axios.get('/.auth/me', { withCredentials: true}).then(response => {
  const accessToken = response.data.access_token;
  // Call backend APIs using this access token.
});
```

# In Development

All of this works great once you have deployed your application to Azure and have enabled App Service Authentication / Authorization. But when running your Express server (that provides your public web application and API endpoints) locally, on your development machine, none of this infrastructure exists! There is no App Service front-end, no cookies, and no easy way to get your access token or user claims. Various solutions have been proposed, including creating a surrogate user and other work arounds.

But ultimately, what you want - especially if accessing back-end services such as the Graph API - is the same exact same experience, with no change to your web application, when running locally versus deployed to Azure App Services. This module does exactly that. It does it in such a way that you don't need to change a single line of code in your web application.

## Why is this so incredibly difficult?

The short answer is, because it has to be. The OAuth 2.0 dance that is done by any authenication framework, Azure or otherwise, is non-trivial. The Azure App Service Easy Auth framework makes it easy by abstracting all of the token acquisition logic out of your application and into the Azure App Service framework. That's very convenient, until you want to make it work and test it on your local develoment machine located, of course, outside of this framework. Here is how this flow works for your application once deployed to Azure:

1. Your user tries to access your application but is not yet signed in.
2. They are redirected to the federated Microsoft login page.
3. After successfully signing in, they receive an `AppServiceAuthSession` cookie and are allowed to access your application.
4. Within the JavaScript of your web application, you can call the `/.auth/me` endpoint to get an access token that you can then use as the bearer token when accessing your Express APIs.
5. Your Express APIs can grab this access token and access other APIs such as the Graph API on the user's behalf.
6. If the access token expires, your JavaScript can access the `/.auth/refresh` endpoint followed by another call to the `/.auth/me` endpoint to get the refreshed token.
7. You can easily sign out by having a `Sign Out` button in your app call the `/.auth/logout` endpoint.

All of these details (included in the Azure Active Directory Authentication Library - ADAL) are now handled by the Easy Auth framework. All you need to do is make a few GET requests from your web application and the magic is taken care of behind the scenes.

### Problem #1

Now you want to run your application on your local development machine...

There's the first problem: there is no `/.auth/me` endpoint! That's OK, you say, I will simply access it directly from my web application by using the fully-qualified URL. So, I'll change my `axios.get` request to `GET https://myapp.azurewebsites.net/.auth/me` (instead of `GET /.auth/me`) and receive my access token that way.

Now, assuming you've *already signed into the Azure version of your app*, the cookies will be forwarded because `withCredentials` is set to `true`.

Suddenly your browser rewards you with a CORS policy violation.

    No 'Access-Control-Allow-Origin' header is present on the requested resource.

Well, that's not really an issue... I can just run Chrome with security disabled using the `--disable-web-security` option. Yep, that works until...

### Problem #2

As a good developer, you want to try out your web application in other browsers, such as Microsoft Edge. Disabling security is easy in Chrome, but not so easy in Edge. Besides, is that really what you want to put in your `README` file for your fellow developers... that, during development you must disable security and here are all of the instructions for how to do that for each browser? No, of course not.

But there's an easy solution. In the Azure portal, there's an API section with a CORS entry. Just go and enter a wildcard (`*`) under "Allowed Origins" in there and now everything will work. (Again, remembering to first sign in on the Azure site so your cookie is set.)

That didn't work! I still get a CORS policy violation. However, on closer examination, you see that it's a slightly different error. This time it complains that you can't have a wildcard (`*`) when performing a `withCredentials` request.

    The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.

Easy fix: change the `*` to your local host URL.

Oh boy, another CORS error. But this time it's slighly different once again:

    The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.

That was unexpected.

### Problem #3

Setting the CORS Allowed Origins in the Azure portal only fixes the `Access-Control-Allow-Origins` header but does nothing for the `Access-Control-Allow-Credentials` header that is required for all of this to work.

Obviously, there is no solution because you can't change the internal Easy Auth infrastructure driven by the Azure portal. You start writing all of this down because it is becoming a nightmare:

1. I want to access the remote `https://myapp.azurewebsites.net/.auth/me` endpoint to get my access token.
2. I want to do it from my localhost during development. I know that I need to do this `withCredentials` so the `AppServiceAuthSession` cookie is sent.
3. The CORS policy prevents me from doing this and I don't want my developers to always run their browser with security disabled, which is more difficult if we are testing with Edge.
4. I can't use the Azure portal CORS feature because it only sets one of the required headers and not the one that allows my browser to send the cookie.
5. I give up.

### Solution

1. **IMPORTANT** *Remove all CORS origins that you may have added in the Azure portal.* If you have any entries here, the CORS headers created by this middleware will not be sent.
2. Add this `asure-easy-auth-local` middleware module to your Express app.
3. Deploy your app to Azure.
4. Change your fully-qualified endpoint calls in your JavaScript back to the simple relative URLs (`/.auth/me` and `/.auth/refresh`).
5. Run your same app locally (`npm start`).
6. Sign into your app on Azure to get the browser cookie.
7. Access your web app locally and watch everything work.

Your developers only need to do steps 5, 6, and 7 during development.

# Internals

How does the `azure-easy-auth-local` middleware module solve this problem?

It works on the principle that it is deployed both in Azure and is also running locally. Here is the flow:

1. Your web app JavaScript tries to access the `/.auth/me` endpoint locally.
2. The local variant of this middleware responds with a 302 (Redirect) to the corresponding URL at `https://myapp.azurewebsites.net/auth/me`. Notice that this URL *does not* have the dot prefix on the `auth` path.
3. The Azure variant of this middleware response to the non-dotted endpoint, takes the cookie from the header, and proxies the request *on your behalf* to the *actual* `https://myapp.azurewebsites.net/.auth/me` endpoint.
4. The Azure variant of this middleware then sends back the Easy Auth response *along with all the required CORS headers* so your browser is happy.
5. Your locally-running app is none-the-wiser thinking it successfully is running in Azure and was able to access the `/.auth/me` endpoint.

That's a lot of verbiage for a very simple solution. However, the problem is a bit harder and this imaginary dialog was required to illustrate its complexities. Hopefully, this will resolve the same situation for you as it did for me. You can now:

* Debug locally using the same App Service Authentication / Authorization feature available to you in the cloud.
* You can do so without having to run your browser with security disabled making it easier on your developers and making the process look a bit more professional.

Please note that none of this matters once your application is running in production mode on Azure. The Azure App Service framework will see and respond to all `/.auth/*` requests and this middleware will not be called.

# License

MIT License

Copyright (c) 2018 Buchanan & Edwards

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
