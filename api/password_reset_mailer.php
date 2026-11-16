<?php
declare(strict_types=1);

require_once __DIR__ . '/config/config.php';

use PHPMailer\PHPMailer\Exception as MailerException;
use PHPMailer\PHPMailer\PHPMailer;

function password_reset_mailer_configured(): bool {
    $autoload = dirname(__DIR__) . '/vendor/autoload.php';
    $secureTransportConfigured = ELEVATE_SMTP_ENCRYPTION === 'tls' || ELEVATE_SMTP_ENCRYPTION === 'ssl';
    $baseUrlConfigured = ELEVATE_BASE_URL !== '' &&
        filter_var(ELEVATE_BASE_URL, FILTER_VALIDATE_URL) !== false &&
        in_array(strtolower((string)parse_url(ELEVATE_BASE_URL, PHP_URL_SCHEME)), ['http', 'https'], true);
    if (ELEVATE_ENV === 'production') {
        $baseUrlConfigured = $baseUrlConfigured && strtolower((string)parse_url(ELEVATE_BASE_URL, PHP_URL_SCHEME)) === 'https';
    }

    return is_file($autoload) &&
        ELEVATE_SMTP_HOST !== '' &&
        ELEVATE_SMTP_PORT >= 1 &&
        ELEVATE_SMTP_PORT <= 65535 &&
        $secureTransportConfigured &&
        ELEVATE_SMTP_USERNAME !== '' &&
        ELEVATE_SMTP_PASSWORD !== '' &&
        filter_var(ELEVATE_MAIL_FROM, FILTER_VALIDATE_EMAIL) !== false &&
        $baseUrlConfigured;
}

function send_password_reset_email(string $recipient, string $recipientName, string $resetUrl): void {
    $autoload = dirname(__DIR__) . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        throw new RuntimeException('PHPMailer is not installed. Run composer install in the project directory.');
    }
    require_once $autoload;

    if (!password_reset_mailer_configured()) {
        throw new RuntimeException('SMTP password-reset email configuration is incomplete.');
    }

    $mailer = new PHPMailer(true);
    try {
        $mailer->isSMTP();
        $mailer->Host = ELEVATE_SMTP_HOST;
        $mailer->SMTPAuth = true;
        $mailer->Username = ELEVATE_SMTP_USERNAME;
        $mailer->Password = ELEVATE_SMTP_PASSWORD;
        $mailer->Port = ELEVATE_SMTP_PORT;
        $mailer->Timeout = 15;
        $mailer->SMTPDebug = 0;
        $mailer->CharSet = PHPMailer::CHARSET_UTF8;
        $mailer->SMTPSecure = ELEVATE_SMTP_ENCRYPTION === 'ssl'
            ? PHPMailer::ENCRYPTION_SMTPS
            : PHPMailer::ENCRYPTION_STARTTLS;
        $mailer->setFrom(ELEVATE_MAIL_FROM, ELEVATE_MAIL_FROM_NAME);
        $mailer->addAddress($recipient, $recipientName);
        $mailer->isHTML(true);
        $mailer->Subject = 'Reset your Elevate password';

        $safeName = htmlspecialchars($recipientName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeUrl = htmlspecialchars($resetUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $mailer->Body = '<p>Hello ' . $safeName . ',</p>' .
            '<p>We received a request to reset your Elevate password. Use the link below within 60 minutes:</p>' .
            '<p><a href="' . $safeUrl . '">Reset your password</a></p>' .
            '<p>If you did not request this, you can ignore this email. Your password will not change.</p>';
        $mailer->AltBody = "Hello {$recipientName},\n\nWe received a request to reset your Elevate password. " .
            "Use this link within 60 minutes:\n{$resetUrl}\n\n" .
            "If you did not request this, you can ignore this email. Your password will not change.";
        $mailer->send();
    } catch (MailerException $e) {
        throw new RuntimeException('SMTP delivery failed: ' . $mailer->ErrorInfo, 0, $e);
    }
}
