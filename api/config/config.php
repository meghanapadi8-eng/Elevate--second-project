<?php
declare(strict_types=1);

// Set these values for your local MySQL installation or hosting environment.
const DB_HOST = '127.0.0.1';
const DB_NAME = 'elevate';
const DB_USER = 'root';
const DB_PASS = '';
const JWT_SECRET = 'Elevate_Local_2026_7fK9mP2xQ8vR4nL6'; // Set ELEVATE_JWT_SECRET in the server environment for production.
const JWT_TTL = 604800;

// Optional AI configuration. Keep the API key on the server; never put it in frontend JavaScript.
const OPENAI_API_KEY = ''; // Prefer setting OPENAI_API_KEY in your server environment.
const OPENAI_MODEL = 'gpt-5.6-luna';

// Job search provider. Keep these credentials on the PHP server only.
const ADZUNA_APP_ID = '';
const ADZUNA_APP_KEY = '';
const ADZUNA_COUNTRY = 'in';
