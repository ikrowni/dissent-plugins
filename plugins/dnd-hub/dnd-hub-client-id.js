// dnd-hub-client-id.js — this screen's id, stamped on what it publishes so it can recognise its own echo.
// The node echoes every realtime event back to the screen that sent it.
export const CLIENT_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
