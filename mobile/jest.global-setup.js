// The Swift tests pinned their calendars to Europe/Dublin; the ported ones run in it too, so
// "today", "midnight" and the clock changes mean the same thing on every machine.
module.exports = async () => {
  process.env.TZ = 'Europe/Dublin';
};
