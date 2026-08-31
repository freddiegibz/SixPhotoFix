const { Resend } = require('resend');

const TEST_RECIPIENT = 'adsbyalfred@protonmail.com';
const DEFAULT_TEST_SENDER = 'onboarding@resend.dev';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Visit this endpoint with a GET request.',
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'RESEND_API_KEY is not configured.',
    });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    DEFAULT_TEST_SENDER;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: TEST_RECIPIENT,
      subject: 'AI Confidence Kit Email Test',
      text: 'This is a test email from the AI Confidence Kit.',
    });

    if (error) {
      return res.status(502).json({
        success: false,
        error: error.message || 'Resend rejected the email request.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully.',
      emailId: data?.id,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected email error.',
    });
  }
};
