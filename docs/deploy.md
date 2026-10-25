# Deploy Front Desk to Google Cloud Run

Only `main` deploys, and `main` only receives MRs that passed the mutation gate. The pipeline in [`ci/release.gitlab-ci.yml`](../ci/release.gitlab-ci.yml):

1. `demo:evidence` runs a real mutation review of the demo contract on that commit.
2. `deploy:cloud-run` downloads that evidence, builds the Dockerfile once with Cloud Build, deploys service `mutant-review-front-desk`, then runs [`ci/smoke.sh`](../ci/smoke.sh) against the live URL: health, deployed revision, evidence and ledger endpoints. If the smoke test fails it routes 100% of traffic back to the previous revision and fails the job.
3. `monitor:smoke` repeats the smoke test after each deploy and on any pipeline schedule (**Build > Pipeline schedules**, for example hourly).

Deploy jobs are skipped until `GCP_PROJECT_ID` is set.

## One-time Google Cloud setup (keyless, Workload Identity Federation)

```sh
PROJECT_ID=<your-project>
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com --project $PROJECT_ID

gcloud iam service-accounts create gitlab-deployer --project $PROJECT_ID
SA=gitlab-deployer@$PROJECT_ID.iam.gserviceaccount.com
for role in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.admin roles/storage.admin roles/iam.serviceAccountUser roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member serviceAccount:$SA --role $role
done

gcloud iam workload-identity-pools create gitlab --location global --project $PROJECT_ID
gcloud iam workload-identity-pools providers create-oidc gitlab-com --location global --workload-identity-pool gitlab \
  --project $PROJECT_ID --issuer-uri https://gitlab.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.project_path == 'mutant-review1/mutant-review' && assertion.ref == 'main'"
gcloud iam service-accounts add-iam-policy-binding $SA --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/gitlab/attribute.project_path/mutant-review1/mutant-review"
```

The provider uses its default allowed audience, `https://iam.googleapis.com/<provider>`, matching the pipeline's ID token. Do not set the allowed audience to `https://gitlab.com`: that differs from the token the pipeline requests and authentication fails. See [Google Cloud's audience guidance](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).

Then add these CI/CD variables (protected is fine; deploys run on `main`):

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | your project ID |
| `GCP_REGION` | optional, default `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/gitlab/providers/gitlab-com` |
| `GCP_SERVICE_ACCOUNT` | `gitlab-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |

A service-account key in a **file** variable `GCP_SERVICE_ACCOUNT_KEY` also works, but keyless is preferred.

The service URL appears on **Operate > Environments > production**. The service is public and read-only: no write credential is ever deployed with it.
