# Railway Edge Functions runtime for Language Gateways.
#
# The application functions come from this repository's controlled migration
# branch. Runtime plumbing is pinned to the exact upstream template revision
# that was verified during the migration.
FROM supabase/edge-runtime:v1.76.2

RUN set -eux; \
    if ! command -v openssl >/dev/null 2>&1; then \
        apt-get update; apt-get install -y --no-install-recommends openssl; rm -rf /var/lib/apt/lists/*; \
    fi; \
    mkdir -p /home/deno/functions/main \
             /home/deno/functions/approve-join-request \
             /home/deno/functions/send-email

ADD https://raw.githubusercontent.com/baranberkay96/supabase-railway/3ee9e9dac2f27e471172afa282ea56939c430926/services/functions/functions/main/index.ts /home/deno/functions/main/index.ts
ADD https://raw.githubusercontent.com/baranberkay96/supabase-railway/3ee9e9dac2f27e471172afa282ea56939c430926/services/functions/functions/deno.jsonc /home/deno/functions/deno.jsonc
ADD https://raw.githubusercontent.com/baranberkay96/supabase-railway/3ee9e9dac2f27e471172afa282ea56939c430926/services/functions/supabase-keys.sh /usr/local/bin/supabase-keys.sh
ADD https://raw.githubusercontent.com/baranberkay96/supabase-railway/3ee9e9dac2f27e471172afa282ea56939c430926/services/functions/railway-entrypoint.sh /usr/local/bin/railway-entrypoint.sh

ADD https://raw.githubusercontent.com/timfnash/language-gateways/railway-migration/supabase/functions/approve-join-request/index.ts /home/deno/functions/approve-join-request/index.ts
ADD https://raw.githubusercontent.com/timfnash/language-gateways/railway-migration/supabase/functions/send-email/index.ts /home/deno/functions/send-email/index.ts

RUN chmod 0755 /usr/local/bin/supabase-keys.sh /usr/local/bin/railway-entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/railway-entrypoint.sh"]
