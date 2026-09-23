import { pinStatus } from "@/lib/auth/pin";
import { PinForm } from "./pin-form";
import { lockNow } from "./actions";

export default async function SecurityPage() {
  const { hasPin } = await pinStatus();

  return (
    <>
      <div className="head">
        <h1>Security</h1>
        <p>
          A PIN locks this console on devices that are already signed in. It is not a way to
          sign in — without a session it does nothing at all.
        </p>
      </div>

      <h2 style={{ marginTop: 8 }}>{hasPin ? "Change your PIN" : "Set a PIN"}</h2>
      <PinForm hasPin={hasPin} />

      {hasPin && (
        <>
          <h2 style={{ marginTop: 28 }}>This device</h2>
          <p className="dim" style={{ marginBottom: 12 }}>
            Unlocked for 12 hours at a time. Locking now ends it here and everywhere else it
            is still valid.
          </p>
          <form action={lockNow}>
            <button type="submit">Lock now</button>
          </form>
        </>
      )}

      <h2 style={{ marginTop: 28 }}>What this does and does not do</h2>
      <ul className="dim" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Four digits is 10,000 guesses, so it is never accepted as a credential on its own.</li>
        <li>Five wrong tries locks the PIN for fifteen minutes.</li>
        <li>Forgetting it costs nothing — sign in with your password and set a new one.</li>
        <li>Changing it signs every unlocked browser back out.</li>
        <li>It does not protect a stolen session cookie, which is already full access.</li>
      </ul>
    </>
  );
}
