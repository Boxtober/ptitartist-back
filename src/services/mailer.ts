const smtpUrl = process.env.SMTP_URL;

let transporter: any = null;

export async function sendEmail(to: string, subject: string, html: string) {
  if (!smtpUrl) {
    console.log('mailer noop - no SMTP configured. Would send to:', to, subject);
    return;
  }

  if (!transporter) {
    // dynamic import to avoid throwing when nodemailer isn't installed in lightweight setups
    // @ts-ignore - nodemailer may not be installed in all environments; import dynamically
    const { default: nodemailer } = await import('nodemailer');
    transporter = nodemailer.createTransport(smtpUrl);
  }

  await transporter.sendMail({ from: process.env.SMTP_FROM || 'no-reply@example.com', to, subject, html });
}

export default { sendEmail };
