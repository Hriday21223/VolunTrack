# Security Policy

## Reporting a Vulnerability

If you discover a security issue in this repository, please report it through [GitHub Security Advisories](https://github.com/Hriday21223/VolunteerTrack/security/advisories).

If you need private disclosure, enable private vulnerability reporting in the repository settings and use that channel.

## Security Contact

Please use GitHub Security Advisories or the repository security settings for responsible disclosure.

## Security Measures Implemented

### Authentication & Authorization
- **Password Hashing**: Uses bcrypt with 10 salt rounds for secure password storage
- **JWT Tokens**: Authentication tokens signed with HS256 algorithm and 30-day expiration
- **Role-Based Access Control**: Three-tier role system (admin, school, student) with middleware enforcement
- **Token Verification**: All protected routes require valid JWT tokens
- **Environment-Based Secrets**: JWT_SECRET required in production, refuses to start with insecure defaults

### Rate Limiting
- **Auth Endpoints**: 5 requests per 15 minutes for login/register to prevent brute force attacks
- **Email Endpoints**: 10 requests per hour for email-sending endpoints to prevent abuse
- **General API**: 100 requests per 15 minutes for general API usage
- **Standard Headers**: Includes standard rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, etc.)

### Bot Protection
- **Cloudflare Turnstile**: Optional proof-of-humanity check on the public, unauthenticated write endpoints (`POST /api/contact`, `POST /api/auth/register`, `POST /api/school/register`, `POST /api/organization/register`) — closes the gap where a bot rotating IPs bypasses per-IP rate limits
- **Opt-in**: Enabled only when `TURNSTILE_SECRET_KEY` (server) and `VITE_TURNSTILE_SITE_KEY` (client) are set; a no-op otherwise, so local dev and the client-only demo are unaffected
- **Server-side verification**: Tokens are verified against Cloudflare's `siteverify` API in `server/turnstile.js` before the route handler runs — the client-side widget alone is never trusted

### Input Validation & Sanitization
- **Email Validation**: Uses validator library with RFC 5322 compliance and length limits (max 254 chars)
- **Name Validation**: Unicode-safe regex allowing letters, spaces, hyphens, and apostrophes (max 100 chars)
- **Password Validation**: Length requirements (8-128 chars) with type checking
- **Request Body Size**: Limited to 1MB to prevent denial of service
- **Type Checking**: Strict type validation for all input parameters
- **Trimming**: Automatic trimming of whitespace from user inputs

### Database Security
- **Parameterized Queries**: All database queries use parameterized statements to prevent SQL injection
- **Connection Security**: Requires TLS for production database connections
- **Least Privilege**: Database schema designed with minimal required permissions
- **Environment Separation**: Database is optional - app runs in email-only mode if not configured

### API Security
- **CORS Configuration**: Cross-origin resource sharing properly configured
- **Error Handling**: Generic error messages to prevent information leakage
- **No Debug Info**: Production mode disables debug information
- **Secure Defaults**: Secure defaults for all configuration options

### Deployment Security
- **Environment Variables**: Sensitive data stored in environment variables, never committed
- **Production Secrets**: Requires JWT_SECRET, DATABASE_URL in production
- **Admin Account Seeding**: Optional admin account creation on startup from environment variables
- **Health Checks**: Secure health check endpoint for monitoring

## Future Security Enhancements
- HTTPS enforcement (already handled by hosting platform)
- Content Security Policy headers
- Input sanitization for school names and other user-generated content
- CSRF protection for state-changing operations
- Account lockout after failed login attempts
- Password strength requirements
- Two-factor authentication option
- Audit logging for admin actions
