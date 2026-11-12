// Careers emails, sent through Brevo with the Worker's own key (CAREERS_BREVO_KEY).
// No key configured -> sendMail returns { skipped } and the queue keeps the email for later.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

function shell(body) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1d2330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e3e6ec">
<tr><td style="padding:28px 30px 8px;font-size:15px;line-height:1.65">${body}</td></tr>
<tr><td style="padding:10px 30px 26px;font-size:12.5px;color:#7b8496;border-top:1px solid #eef0f4">
Forus Intelligence Labs &middot; <a href="https://forusintelligencelabs.com" style="color:#3b6fe0;text-decoration:none">forusintelligencelabs.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** Kept on file: below the academic bar, but skills worth remembering. */
export function regretEmail(a) {
  const n = esc(firstName(a.fullName));
  const role = esc(a.roleTitle || "the open role");
  return {
    subject: `Your application for ${a.roleTitle || "our open role"} at Forus Intelligence Labs`,
    html: shell(`<p>Hi ${n},</p>
<p>Thank you for applying for the <b>${role}</b> role at Forus Intelligence Labs, and for the time you put into telling us about your work. We genuinely enjoyed reading it.</p>
<p>We have reviewed your application carefully. At this time we will not be moving forward with it for this opening. This was a hard call with many strong applicants, and it is not a judgement on your ability.</p>
<p>We have kept your resume and profile on file. When new openings come up that match your experience, we will consider you for them and get in touch. <b>There is no need to apply again.</b></p>
<p>Thank you once more for your interest in building with us. We wish you the very best in what comes next.</p>
<p>Warm regards,<br>The Tech Team<br>Forus Intelligence Labs</p>`),
  };
}

/** Closing: application not taken forward and not kept. Still kind, no promises. */
export function closingEmail(a) {
  const n = esc(firstName(a.fullName));
  const role = esc(a.roleTitle || "the open role");
  return {
    subject: `Your application for ${a.roleTitle || "our open role"} at Forus Intelligence Labs`,
    html: shell(`<p>Hi ${n},</p>
<p>Thank you for applying for the <b>${role}</b> role at Forus Intelligence Labs and for your interest in what we are building.</p>
<p>After reviewing your application, we will not be taking it forward for this opening. We look for hands-on experience with the specific tools and work this role involves, and the fit was not close enough this time.</p>
<p>We would be glad to see you apply again in future as your experience grows. Building and shipping your own projects, and sharing them on GitHub or a portfolio, is the best way to show us your work.</p>
<p>We wish you every success.</p>
<p>Warm regards,<br>The Tech Team<br>Forus Intelligence Labs</p>`),
  };
}

/**
 * @param {object} env  Worker env: CAREERS_BREVO_KEY, CAREERS_FROM_EMAIL, CAREERS_FROM_NAME, CAREERS_REPLY_TO
 * @returns {Promise<{sent?:true, messageId?:string, skipped?:string, error?:string}>}
 */
export async function sendMail(env, to, { subject, html }) {
  const key = env?.CAREERS_BREVO_KEY;
  const from = env?.CAREERS_FROM_EMAIL;
  if (!key || !from) return { skipped: "email not configured yet (CAREERS_BREVO_KEY / CAREERS_FROM_EMAIL)" };
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: env.CAREERS_FROM_NAME || "Forus Intelligence Labs Careers", email: from },
        to: [{ email: to }],
        replyTo: { email: env.CAREERS_REPLY_TO || "tech@foruselectric.com" },
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: `Brevo ${r.status}: ${j.message || "send failed"}` };
    return { sent: true, messageId: j.messageId };
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "Brevo timed out" : String(e?.message || e) };
  }
}
