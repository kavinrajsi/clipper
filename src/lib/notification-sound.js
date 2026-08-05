// The notification chime.
//
// Module-level singleton rather than one Audio per play: the browser then
// fetches and decodes the file once, so the first notification of a session is
// not the one that arrives silently while the mp3 is still downloading.
//
// AUTOPLAY POLICY. play() returns a promise that rejects with NotAllowedError
// until the document has had a real user gesture. That is normal, not a fault
// — a notification can legitimately arrive on a page the user has not clicked
// yet — but an unhandled rejection would log an error every time. Swallowed
// here so the caller never has to think about it.

const SOUND_URL = "/music/notification/soft-chime-message-notification.mp3";

let audio = null;

export function playNotificationSound() {
  if (typeof window === "undefined") return;

  if (!audio) {
    audio = new Audio(SOUND_URL);
    audio.preload = "auto";
  }

  // Two notifications in quick succession would otherwise leave the second
  // one playing from wherever the first got to.
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
