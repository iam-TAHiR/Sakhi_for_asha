# Sakhi for asha 

A browser-based voice-assisted visit dashboard built with HTML, CSS, and JavaScript.

## Demo sign in

The login page accepts this demo credential:

- **Demo ID:** `asha-demo`
- **Password:** `Sakhi@123`

After signing in, use the workspace tabs to open the dashboard, new visit, voice notes, visit records, or emergency flags. Visit details and voice transcripts stay in the shared draft while switching between the New visit and Voice notes tabs.

This credential is embedded in the frontend and is not secure authentication. There is no server, account recovery, or synchronization. Do not use this demo to protect or store real patient information.

## Run locally

Open `index.html` in a browser, or serve this folder from localhost:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Microphone and location access require permission; browsers generally allow these features on `localhost` or HTTPS.

## Features

- Capture a person's name, household ID, village, and optional phone number.
- Record voice notes, play them back, and review or correct the editable transcript.
- Choose from English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, and Malayalam for browser speech recognition.
- Capture device location and save it with the note and timestamp.
- Save visits, including recordings, in this browser's IndexedDB database. Records are scoped to the signed-in local account and are not sent to an application server.
- Flag emergencies manually or when a listed emergency phrase appears in the transcript. Flagged records appear in the dashboard and trigger a browser audio alert.

Speech recognition availability and privacy vary by browser; some browsers process speech using their provider's service. Review the browser's privacy settings before recording sensitive information. Emergency phrase detection is a basic keyword check, not a medical assessment. Audio alerts only play in the app; the app does not contact emergency services.
