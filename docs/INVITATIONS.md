# Inviting people

Only people in the `invitations` table can create an account. When they sign up, their profile is
filled in from their invitation, and they can correct it on first sign-in.

**Never commit attendee lists to this repo** (it's public). Keep the CSV on your Mac.

## Before inviting a new church or cohort

In **Supabase → Table Editor**, add a row to `churches` (if it's a new church) and to `cohorts`.
The `id` values are short lower-case codes with hyphens, used in the CSV:

| table    | id                              | other columns |
|----------|---------------------------------|---------------|
| churches | `freedom-church-jersey`         | name: Freedom Church Jersey |
| cohorts  | `freedom-church-jersey-2026-09` | church: `freedom-church-jersey`, name, starts_on |

## Importing a CSV

1. Make a spreadsheet with exactly these column headings, and save it as CSV:

   | church | cohort | email | given_name | family_name | mother_tongue | other_languages |
   |--------|--------|-------|------------|-------------|---------------|-----------------|
   | freedom-church-jersey | freedom-church-jersey-2026-09 | ana@example.com | Ana | Silva | Portuguese | English, French |

   `church`, `cohort` and `email` are required; the rest can be blank.
   Emails can be in any case: they're stored in lower case.
2. **Table Editor → invitations → Insert → Import data from CSV**, choose the file, check the
   preview, and import.

If a row is rejected, the usual cause is a `church`/`cohort` pair that doesn't exist, or a cohort
that belongs to a different church.

## Adding one person

**Table Editor → invitations → Insert → Insert row**, then fill in the same fields.

## Admins

Admins can see every profile and manage churches, cohorts and invitations. To add one, insert their
email into the `admins` table (it's only editable from the dashboard).
