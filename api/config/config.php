<?php
declare(strict_types=1);

$production = strtolower(trim((string)(getenv('ELEVATE_ENV') ?: 'development'))) === 'production';
define('ELEVATE_ENV', $production ? 'production' : 'development');

define('DB_HOST', trim((string)(getenv('ELEVATE_DB_HOST') ?: '127.0.0.1')));
define('DB_NAME', trim((string)(getenv('ELEVATE_DB_NAME') ?: 'elevate')));
define('DB_USER', trim((string)(getenv('ELEVATE_DB_USER') ?: ($production ? '' : 'root'))));
define('DB_PASS', (string)(getenv('ELEVATE_DB_PASS') ?: ''));
define('JWT_SECRET', trim((string)(getenv('ELEVATE_JWT_SECRET') ?: ($production ? '' : 'Elevate_Local_2026_7fK9mP2xQ8vR4nL6'))));
define('AUTH_TOKEN_TTL', 43200);

define('OPENAI_API_KEY', trim((string)(getenv('OPENAI_API_KEY') ?: '')));
define('OPENAI_MODEL', trim((string)(getenv('OPENAI_MODEL') ?: 'gpt-5.6-luna')));
define('ADZUNA_APP_ID', trim((string)(getenv('ADZUNA_APP_ID') ?: '')));
define('ADZUNA_APP_KEY', trim((string)(getenv('ADZUNA_APP_KEY') ?: '')));
define('ADZUNA_COUNTRY', trim((string)(getenv('ADZUNA_COUNTRY') ?: 'in')));

define('ELEVATE_BASE_URL', rtrim(trim((string)(getenv('ELEVATE_BASE_URL') ?: ($production ? '' : 'http://localhost/Elevate'))), '/'));
define('ELEVATE_SMTP_HOST', trim((string)(getenv('ELEVATE_SMTP_HOST') ?: '')));
define('ELEVATE_SMTP_PORT', (int)(getenv('ELEVATE_SMTP_PORT') ?: 587));
define('ELEVATE_SMTP_ENCRYPTION', strtolower(trim((string)(getenv('ELEVATE_SMTP_ENCRYPTION') ?: 'tls'))));
define('ELEVATE_SMTP_USERNAME', trim((string)(getenv('ELEVATE_SMTP_USERNAME') ?: '')));
define('ELEVATE_SMTP_PASSWORD', (string)(getenv('ELEVATE_SMTP_PASSWORD') ?: ''));
define('ELEVATE_MAIL_FROM', trim((string)(getenv('ELEVATE_MAIL_FROM') ?: '')));
define('ELEVATE_MAIL_FROM_NAME', trim((string)(getenv('ELEVATE_MAIL_FROM_NAME') ?: 'Elevate')));
