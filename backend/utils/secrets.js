import fs from 'fs';
import path from 'path';

/**
 * Reads a secret from Docker Secrets (/run/secrets/) or environment variables.
 * @param {string} secretName The name of the secret/env var.
 * @param {string} defaultValue Optional default value.
 * @returns {string} The secret value.
 */
export function getSecret(secretName, defaultValue = null) {
    // 1. Try Docker Secrets
    const secretPath = path.join('/run/secrets', secretName);
    try {
        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, 'utf8').trim();
        }
    } catch (err) {
        // Fallback to env
    }

    // 2. Try Environment Variables (case insensitive match for convenience)
    const envValue = process.env[secretName] || process.env[secretName.toUpperCase()] || process.env[secretName.toLowerCase()];
    if (envValue !== undefined) {
        return envValue;
    }

    return defaultValue;
}

export default getSecret;
