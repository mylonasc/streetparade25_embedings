{{- define "sp26-emb-test.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sp26-emb-test.fullname" -}}
{{- $name := include "sp26-emb-test.name" . -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "sp26-emb-test.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: sp26-emb
{{- end -}}

{{- define "sp26-emb-test.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "sp26-emb-test.namespace" -}}
{{- .Values.namespace.name | default .Release.Namespace -}}
{{- end -}}

{{- define "sp26-emb-test.image" -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end -}}

{{- define "sp26-emb-test.dataClaimName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{- printf "%s-data" (include "sp26-emb-test.fullname" .) -}}
{{- end -}}
{{- end -}}
