// Tap Survey settings. The three URLs are the "HTTP URL" of each Power Automate flow's trigger.
window.TAP_CONFIG = {
  LOGIN_URL:  "PASTE_LOGIN_URL",   // Draft Survey - Login
  ROUTE_URL:  "PASTE_ROUTE_URL",   // Draft Survey - Get My Route
  SUBMIT_URL: "PASTE_SUBMIT_URL",  // Draft Survey - Submit Visit

  // Line cleaning questions, in order. Saved in Cleaning Records as CleanQ1..CleanQ4.
  // type: "yn" (Yes/No), "num", "pick" (with opts), "text". required: must be answered.
  // The tap photo and the manager signature are their own steps, so they are not listed here.
  QUESTIONS: [
    { id: "q1", text: "What type of line cleaning?", type: "pick", opts: ["Regular", "Acid"], required: true },
    { id: "q2", text: "Was a pump used?", type: "yn", required: true },
    { id: "q3", text: "Is the line longer than 15 ft?", type: "yn", required: true },
    { id: "q4", text: "How long did it take to clean? (minutes)", type: "num", required: true }
  ],

  PHOTO_REQUIRED: true,
  PHOTO_MAX_PX: 1280,
  RETRY_SECONDS: 60
};
