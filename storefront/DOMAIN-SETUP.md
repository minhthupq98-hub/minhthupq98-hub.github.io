# thekhecoffee.com DNS

Historical setup notes, exported with verification values redacted. The domain is already connected. These notes are not instructions to change current DNS. Use the existing Sites domain settings for current status.

Sites custom-domain registration is pending as of 2026-11-03. Set these records at the domain's DNS provider. Replace only conflicting website records for the apex; preserve unrelated MX and TXT records.

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 162.159.143.30 |
| A | @ | 172.66.3.26 |
| TXT | _openai-site-verification | openai-site-verification=REDACTED_VERIFICATION_VALUE |
| TXT | _cf-custom-hostname | REDACTED_HOSTNAME_VERIFICATION_VALUE |

Some providers require the full hostname instead of the short Name. Keep these verification values unchanged. After DNS propagation, refresh the Sites custom-domain status. The domain currently points to a Coming Soon page; registration alone does not replace the DNS records. DNS account access is not connected in this session.
