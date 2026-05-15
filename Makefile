REGISTRY   ?= docker.io/gangyi89
SHA        := $(shell git rev-parse --short HEAD)

JOB_CONTROLLER_IMAGE := $(REGISTRY)/akabench-job-controller:$(SHA)
WEB_IMAGE            := $(REGISTRY)/akabench-web:$(SHA)

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

.PHONY: build
build: build-job-controller build-web

.PHONY: build-job-controller
build-job-controller:
	docker build \
		--file backend/Dockerfile \
		--tag $(JOB_CONTROLLER_IMAGE) \
		.

.PHONY: build-web
build-web:
	docker build \
		--file frontend/Dockerfile \
		--tag $(WEB_IMAGE) \
		.

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

.PHONY: push
push: push-job-controller push-web

.PHONY: push-job-controller
push-job-controller:
	docker push $(JOB_CONTROLLER_IMAGE)

.PHONY: push-web
push-web:
	docker push $(WEB_IMAGE)

# ---------------------------------------------------------------------------
# Release — build + push + patch manifests with the new SHA tag
# ---------------------------------------------------------------------------

.PHONY: release
release: build push
	# Patch the running Deployments in-place to the just-pushed SHA tag.
	kubectl set image deployment/job-controller \
		job-controller=$(JOB_CONTROLLER_IMAGE)
	kubectl set image deployment/web \
		web=$(WEB_IMAGE)
	@echo "Released $(SHA)"

# ---------------------------------------------------------------------------
# Deploy infrastructure (idempotent)
# ---------------------------------------------------------------------------

.PHONY: deploy-infra
deploy-infra:
	kubectl apply -f deploy/infra/postgres.yaml
	kubectl apply -f deploy/infra/nats.yaml
	kubectl apply -f deploy/infra/gateway-class.yaml

# ---------------------------------------------------------------------------
# Deploy application (idempotent)
# ---------------------------------------------------------------------------

.PHONY: deploy-app
deploy-app:
	kubectl apply -f deploy/app/rbac.yaml
	kubectl apply -f deploy/app/job-controller.yaml
	kubectl apply -f deploy/app/web.yaml

.PHONY: deploy
deploy: deploy-infra deploy-app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

.PHONY: images
images:
	@echo "job-controller : $(JOB_CONTROLLER_IMAGE)"
	@echo "web            : $(WEB_IMAGE)"
