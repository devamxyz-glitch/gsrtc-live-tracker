# Play Store build (Trusted Web Activity)

A TWA is the PWA you already have, wrapped in a thin Android shell. There is no second
codebase: the app on the Play Store loads `tracker.shivrajsinh.in` full-screen, with no browser
bar, and every deploy of the site updates it instantly. Only the wrapper itself needs a new
release, and only when its icon, name or permissions change.

`twa-manifest.json` here is the configuration; everything else is generated.

## Before you start

You need a JDK 17 and the Android SDK. Bubblewrap will offer to install both.

```bash
npm install -g @bubblewrap/cli
```

## 1. Generate the build

```bash
cd twa
bubblewrap init --manifest https://tracker.shivrajsinh.in/manifest.webmanifest
# when it asks, point it at the twa-manifest.json in this folder rather than answering again
bubblewrap build
```

`bubblewrap build` produces `app-release-bundle.aab` (upload this to Play) and
`app-release-signed.apk` (sideload this to test).

## 2. The signing key — read this before you build

Bubblewrap creates `android.keystore` on the first build. **That file and its passwords are the
only proof that future updates come from you.** Lose them and Google will not let you update
this app, ever — the only way forward is a new listing with a new package name and none of your
users.

- Back it up somewhere you will still have in five years, not just on this laptop.
- It is already covered by `.gitignore`; keep it that way.
- Consider Play App Signing, which lets Google hold the upload key and recover it.

## 3. Link the app to the site

Android only drops the browser chrome once the site vouches for the app. Get the fingerprint:

```bash
keytool -list -v -keystore android.keystore -alias android | grep "SHA256:"
```

Put it on the server (not in the repo — it is deployment config):

```bash
ssh -i ~/.ssh/st-tracker-deploy ubuntu@130.210.21.111
cd ~/st-tracker
echo 'TWA_FINGERPRINT="AA:BB:CC:…"' >> .env
echo 'TWA_PACKAGE="in.shivrajsinh.sttracker"' >> .env
pm2 restart st-tracker --update-env
```

Then check it:

```bash
curl https://tracker.shivrajsinh.in/.well-known/assetlinks.json
```

Until the fingerprint is set that URL returns 404 on purpose, rather than serving a file that
claims a link which does not exist. If it is wrong or missing the app still works — it just
shows a browser address bar, which is the usual reason a TWA "looks wrong".

## 4. What Play will ask you for

- A privacy policy URL. The app collects nothing and has no accounts; the Settings screen
  already states this, so a page repeating it is enough.
- Data safety form: no data collected, no data shared. Location is used on-device only.
- Screenshots at phone size, plus a 512×512 icon (`web/icons/icon-512.png`) and a
  1024×500 feature graphic.
- **Be straight about what this is.** It is an independent community app, not a GSRTC product,
  and the listing must not imply otherwise — no GSRTC logo, no official-sounding title. The
  app already carries that disclosure in Settings.

## Updating later

Site changes need nothing — the TWA loads the live site. Only bump `appVersionCode` and
`appVersionName` here and rebuild when the wrapper itself changes.
