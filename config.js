// Tap Survey settings. The three URLs are the "HTTP URL" of each Power Automate flow's trigger.
window.TAP_CONFIG = {
  LOGIN_URL:  "https://default0c07cc35444246a2a2b1a250d653b9.2f.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/24/workflows/3807be17aac54045968bfaebf7739c70/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=Fw1s4E5enXgXLeCXkFAjp2nDX-nHqTnmWmAXqrwqjXw",   // Draft Survey - Login
  ROUTE_URL:  "https://default0c07cc35444246a2a2b1a250d653b9.2f.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/28/workflows/fcc21743dbe3473983851725c9925d3d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=1CZxm3LjLgx5ZcA4uULm4hQSAYoy0_auUcU4NwDVmXw",   // Draft Survey - Get My Route
  SUBMIT_URL: "https://default0c07cc35444246a2a2b1a250d653b9.2f.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/04/workflows/9191430f2ca74ba2b4477ae3943a1700/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8SJFdUqyv80yfBpvN3rXCdKMQpurJ5HPnMALgormNrs",  // Draft Survey - Submit Visit

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
