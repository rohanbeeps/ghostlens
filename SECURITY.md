# Security policy

Report suspected vulnerabilities privately through the repository's **Security** tab and **Report a vulnerability** option when private reporting is enabled. Include the affected version, browser, expected and observed behavior, and a synthetic capture if it helps reproduce the issue.

HAR recordings can include credentials, cookies, internal hostnames, and personal data. Use synthetic fixtures in public reports. Keep real recordings and sensitive screenshots out of issues, pull requests, and public releases.

GhostLens processes imports in the browser. Its redacted view helps limit incidental disclosure. URL hostnames, filenames, and unrecognized path data may still be sensitive. Review what a capture reveals before sharing any output.

**Mask capture details** in **Privacy & help** replaces displayed identifiers and clears the current request search. Use synthetic captures for public reports because traffic statistics can also reveal information.
