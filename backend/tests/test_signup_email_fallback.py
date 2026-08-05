import unittest
from unittest.mock import patch

from main import send_signup_verification_email


class SignupEmailFallbackTests(unittest.TestCase):
	def test_uses_smtp_when_configured_even_if_resend_is_available(self) -> None:
		with patch("main.RESEND_API_KEY", "fake-key"), patch("main.SIGNUP_SMTP_HOST", "smtp.example.com"), patch(
			"main.SIGNUP_SMTP_LOGIN", "user"
		), patch("main.SIGNUP_SMTP_PASSWORD", "pass"), patch("main.SIGNUP_SMTP_FROM_EMAIL", "from@example.com"), patch(
			"main.send_resend_email"
		) as mock_resend, patch("main.send_smtp_email") as mock_smtp:
			send_signup_verification_email("user@example.com", "123456")

		mock_resend.assert_not_called()
		mock_smtp.assert_called_once()

	def test_falls_back_to_resend_when_smtp_fails(self) -> None:
		with patch("main.RESEND_API_KEY", "fake-key"), patch("main.SIGNUP_SMTP_HOST", "smtp.example.com"), patch(
			"main.SIGNUP_SMTP_LOGIN", "user"
		), patch("main.SIGNUP_SMTP_PASSWORD", "pass"), patch("main.SIGNUP_SMTP_FROM_EMAIL", "from@example.com"), patch(
			"main.SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK", True
		), patch("main.send_smtp_email", side_effect=Exception("smtp failed")) as mock_smtp, patch(
			"main.send_resend_email"
		) as mock_resend:
			send_signup_verification_email("user@example.com", "123456")

		mock_smtp.assert_called_once()
		mock_resend.assert_called_once()

	def test_does_not_use_resend_fallback_by_default(self) -> None:
		with patch("main.RESEND_API_KEY", "fake-key"), patch("main.SIGNUP_SMTP_HOST", "smtp.example.com"), patch(
			"main.SIGNUP_SMTP_LOGIN", "user"
		), patch("main.SIGNUP_SMTP_PASSWORD", "pass"), patch("main.SIGNUP_SMTP_FROM_EMAIL", "from@example.com"), patch(
			"main.SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK", False
		), patch("main.send_smtp_email", side_effect=Exception("smtp failed")) as mock_smtp, patch(
			"main.send_resend_email"
		) as mock_resend:
			with self.assertRaises(Exception):
				send_signup_verification_email("user@example.com", "123456")

		mock_smtp.assert_called_once()
		mock_resend.assert_not_called()


if __name__ == "__main__":
	unittest.main()
