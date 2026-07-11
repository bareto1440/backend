const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const FROM = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'onboarding@example.com';
const SITE_NAME = process.env.SITE_NAME || 'Your Store';
const emailTransport = process.env.EMAIL_TRANSPORT?.toLowerCase();
const hasSmtpConfig = !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
const useSmtp = emailTransport === 'smtp' || (!emailTransport && hasSmtpConfig);
const useEthereal = emailTransport === 'ethereal' || (!emailTransport && !hasSmtpConfig && !process.env.RESEND_API_KEY);
const useResend = emailTransport === 'resend' || (!emailTransport && !!process.env.RESEND_API_KEY && !hasSmtpConfig);
let transporter;
let resend;

if (useResend) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

async function getTransporter() {
  if (transporter) return transporter;

  if (useSmtp) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  transporter._ethereal = true;
  return transporter;
}

async function sendMail(toEmail, subject, html) {
  if (useSmtp || useEthereal) {
    const transport = await getTransporter();
    const info = await transport.sendMail({
      from: FROM,
      to: toEmail,
      subject,
      html,
    });

    if (transport._ethereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log('Ethereal preview URL:', previewUrl);
    }

    return info;
  }

  if (useResend) {
    return resend.emails.send({
      from: FROM,
      to: toEmail,
      subject,
      html,
    });
  }

  throw new Error('No email transport configured. Set EMAIL_TRANSPORT, SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY.');
}

async function sendVerificationEmail(toEmail, verifyCode, verifyUrl) {
  return sendMail(
    toEmail,
    `Verify your email for ${SITE_NAME}`,
    `
      <p>Welcome to ${SITE_NAME}!</p>
      <p>Your verification code is:</p>
      <p style="font-size: 1.6rem; font-weight: bold;">${verifyCode}</p>
      <p>Enter this code on the verification page to confirm your email.</p>
      <p>Or click this link to verify immediately:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This code expires in 24 hours. If you didn't create this account, ignore this email.</p>
    `
  );
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  return sendMail(
    toEmail,
    `Reset your ${SITE_NAME} password`,
    `
      <p>We received a request to reset your password.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email — your password won't change.</p>
    `
  );
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
