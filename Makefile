REGISTRY   ?= registry.akamai.internal/akabench
SHA        := $(shell git rev-parse --short HEAD)

JOB_CONTROLLER_IMAGE := $(REGISTRY)/job-controller:$(SHA)
COLLECTOR_IMAGE      := $(REGISTRY)/collector:$(SHA)

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

.PHONY: build
build: build-job-controller build-collector

.PHONY: build-job-controller
build-job-controller:
	docker build \
		--file backend/Dockerfile \
		--tag $(JOB_CONTROLLER_IMAGE) \
		.

.PHONY: build-collector
build-collector:
	docker build \
		--file backend/collector/Dockerfile \
		--tag $(COLLECTOR_IMAGE) \
		backend/collector

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

.PHONY: push
push: push-job-controller push-collector

.PHONY: push-job-controller
push-job-controller:
	docker push $(JOB_CONTROLLER_IMAGE)

.PHONY: push-collector
push-collector:
	docker push $(COLLECTOR_IMAGE)

# ---------------------------------------------------------------------------
# Release — build + push + patch manifests with the new SHA tag
# ---------------------------------------------------------------------------

.PHONY: release
release: build push
	# Patch the job-controller Deployment image in-place
	kubectl set image deployment/job-controller \
		job-controller=$(JOB_CONTROLLER_IMAGE)
	@echo "Released $(SHA)"

# ---------------------------------------------------------------------------
# Deploy infrastructure (idempotent)
# ---------------------------------------------------------------------------

.PHONY: deploy-infra
deploy-infra:
	kubectl apply -f deploy/infra/postgres.yaml
	kubectl apply -f deploy/infra/nats.yaml

# ---------------------------------------------------------------------------
# Deploy application (idempotent)
# ---------------------------------------------------------------------------

.PHONY: deploy-app
deploy-app:
	kubectl apply -f deploy/app/rbac.yaml
	kubectl apply -f deploy/app/job-controller.yaml

.PHONY: deploy
deploy: deploy-infra deploy-app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

.PHONY: images
images:
	@echo "job-controller : $(JOB_CONTROLLER_IMAGE)"
	@echo "collector      : $(COLLECTOR_IMAGE)"
