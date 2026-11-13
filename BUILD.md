# MigoLive Android preview build

The repository includes a GitHub Actions workflow at `.github/workflows/android-preview.yml`.

- It builds a local-only Android debug APK from the web app and bundled game files.
- Pushes to `main` start the workflow automatically.
- The workflow uploads an artifact named `MigoLive_Test_V2_2026` when the build succeeds.
- The artifact is retained by GitHub Actions for 7 days.
- This is a debug/test APK, not a Google Play release build.

To retrieve it, open the repository's Actions tab, select the latest successful **Build MigoLive local Android APK** run, and download the artifact.
