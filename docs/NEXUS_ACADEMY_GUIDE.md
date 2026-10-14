# Nexus Academy course studio

Open **Team → Nexus Academy → Course studio** as an administrator.

1. Choose **New course**, enter the title, learner summary and lesson content.
2. Choose Academy capability or Security awareness. Add knowledge-check questions, answer choices and the correct answer. Security awareness needs at least one question before publication.
3. Set the passing score and expected duration. Save as a draft while reviewing.
4. Edit the course and select **Publish to assigned learners** when ready.
5. Choose **Assign**, select staff, an optional due date and whether learning is required.

The **Open security-awareness starter** action creates one editable draft with practical lessons and questions about suspicious requests, credentials, MFA and incident reporting. Repeating the action opens the same course and preserves edits.

Learners use **My learning** or **Security awareness**. They read their assigned material, answer the knowledge check and confirm completion. The server marks the answers and retains the score, learner, time, course version and content fingerprint. A failed check can be retried after reviewing the lesson.

Editing a course creates a new version. Existing assignments retain their original material and results. Assign the newer version to request fresh learning. Archiving prevents new assignments and preserves existing learning history. Concurrent editing is protected: if another author saves first, refresh before retrying.

Open **Assign** to review learning history, including earlier course versions, completion times, scores and evidence references. The summary counts apply to the current version so earlier completion does not imply the learner completed newly edited material. Overdue counts exclude completed assignments. Draft and archived courses show history while preventing new assignments.

This release supports authenticated Nexus staff. Customer portal assignments, phishing simulations, campaign email delivery and professional certification are not included. The first-use technician onboarding checklist remains a separate account readiness record.

## Validation

From `backend`, run `..\.venv\Scripts\python.exe -m pytest tests/test_academy.py tests/test_technician_onboarding.py -q -p no:cacheprovider`.

The tests cover administrator restrictions, cross-tenant access, stale edits, repeat assignments, immutable learning material, answer redaction, server grading, completion retries, template retries and archival.
