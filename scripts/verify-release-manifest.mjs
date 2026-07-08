#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseManifest, defaultReleaseManifestSections } from "./generate-release-manifest.mjs";

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function parseManifestArg(args) {
  const index = args.indexOf("--manifest");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return process.env.RELEASE_MANIFEST_PATH || "release/release-manifest.json";
}

function readJsonManifest(path) {
  if (!existsSync(path)) {
    throw new Error(`Release manifest does not exist: ${path}`);
  }

  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Release manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function artifactMap(manifest, errors, label) {
  const map = new Map();
  if (!Array.isArray(manifest.artifacts)) {
    errors.push(`${label}.artifacts must be an array.`);
    return map;
  }

  for (const artifact of manifest.artifacts) {
    if (!artifact?.id) {
      errors.push(`${label}.artifacts contains an item without id.`);
      continue;
    }
    if (map.has(artifact.id)) {
      errors.push(`${label}.artifacts contains duplicate section id ${artifact.id}.`);
      continue;
    }
    map.set(artifact.id, artifact);
  }

  return map;
}

function compareFiles(sectionId, recordedFiles, currentFiles, errors) {
  if (!Array.isArray(recordedFiles)) {
    errors.push(`${sectionId}.files must be an array.`);
    return;
  }

  const recordedByPath = new Map(recordedFiles.map((file) => [file.path, file]));
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));

  for (const file of currentFiles) {
    const recorded = recordedByPath.get(file.path);
    if (!recorded) {
      errors.push(`${sectionId} is missing file ${file.path} from the recorded manifest.`);
      continue;
    }
    if (recorded.bytes !== file.bytes) {
      errors.push(`${sectionId}/${file.path} bytes changed: recorded ${recorded.bytes}, current ${file.bytes}.`);
    }
    if (recorded.sha256 !== file.sha256) {
      errors.push(`${sectionId}/${file.path} sha256 changed.`);
    }
  }

  for (const file of recordedFiles) {
    if (!currentByPath.has(file.path)) {
      errors.push(`${sectionId} recorded file no longer exists: ${file.path}.`);
    }
  }
}

export function verifyReleaseManifest({
  projectRoot = process.cwd(),
  manifestPath = process.env.RELEASE_MANIFEST_PATH || "release/release-manifest.json",
  sections = defaultReleaseManifestSections,
  expectedManifestSha256 = process.env.EXPECTED_RELEASE_MANIFEST_SHA256 || "",
  expectedGitCommit = process.env.EXPECTED_RELEASE_GIT_COMMIT || "",
  expectedSourceRef = process.env.EXPECTED_RELEASE_SOURCE_REF || "",
} = {}) {
  const root = resolve(projectRoot);
  const resolvedManifestPath = resolve(root, manifestPath);
  const recorded = readJsonManifest(resolvedManifestPath);
  const errors = [];

  const current = buildReleaseManifest({
    projectRoot: root,
    sections,
    releaseTarget: recorded.releaseTarget || process.env.RELEASE_TARGET || "local",
    releaseSourceRef: recorded.sourceRef || process.env.RELEASE_SOURCE_REF || process.env.GITHUB_REF_NAME || "",
    generatedAt: recorded.generatedAt || new Date().toISOString(),
  });

  if (expectedManifestSha256 && recorded.manifestSha256 !== expectedManifestSha256) {
    errors.push(
      `EXPECTED_RELEASE_MANIFEST_SHA256 mismatch: expected ${expectedManifestSha256}, recorded ${recorded.manifestSha256}.`,
    );
  }

  if (expectedGitCommit && recorded.git?.commit !== expectedGitCommit) {
    errors.push(`EXPECTED_RELEASE_GIT_COMMIT mismatch: expected ${expectedGitCommit}, recorded ${recorded.git?.commit ?? "none"}.`);
  }

  if (expectedSourceRef && recorded.sourceRef !== expectedSourceRef) {
    errors.push(`EXPECTED_RELEASE_SOURCE_REF mismatch: expected ${expectedSourceRef}, recorded ${recorded.sourceRef ?? "none"}.`);
  }

  if (recorded.manifestVersion !== current.manifestVersion) {
    errors.push(`manifestVersion changed: recorded ${recorded.manifestVersion}, current ${current.manifestVersion}.`);
  }

  if (recorded.releaseTarget !== current.releaseTarget) {
    errors.push(`releaseTarget changed: recorded ${recorded.releaseTarget}, current ${current.releaseTarget}.`);
  }

  if (recorded.sourceRef !== current.sourceRef) {
    errors.push(`sourceRef changed: recorded ${recorded.sourceRef ?? "none"}, current ${current.sourceRef ?? "none"}.`);
  }

  if (recorded.manifestSha256 !== current.manifestSha256) {
    errors.push(`manifestSha256 changed: recorded ${recorded.manifestSha256}, current ${current.manifestSha256}.`);
  }

  const recordedArtifacts = artifactMap(recorded, errors, "recorded");
  const currentArtifacts = artifactMap(current, errors, "current");

  for (const [sectionId, currentSection] of currentArtifacts) {
    const recordedSection = recordedArtifacts.get(sectionId);
    if (!recordedSection) {
      errors.push(`Recorded manifest is missing section ${sectionId}.`);
      continue;
    }

    for (const field of ["fileCount", "totalBytes", "sha256"]) {
      if (recordedSection[field] !== currentSection[field]) {
        errors.push(`${sectionId}.${field} changed: recorded ${recordedSection[field]}, current ${currentSection[field]}.`);
      }
    }

    compareFiles(sectionId, recordedSection.files, currentSection.files, errors);
  }

  for (const sectionId of recordedArtifacts.keys()) {
    if (!currentArtifacts.has(sectionId)) {
      errors.push(`Recorded manifest contains unexpected section ${sectionId}.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifestPath: resolvedManifestPath,
    recorded,
    current,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const manifestPath = parseManifestArg(process.argv.slice(2));
    const result = verifyReleaseManifest({ manifestPath });
    if (!result.ok) {
      for (const error of result.errors) {
        console.error(`[release-manifest-check] FAIL ${error}`);
      }
      process.exit(1);
    }

    console.log(`[release-manifest-check] PASS verified ${normalizePath(relative(process.cwd(), result.manifestPath))}`);
    console.log(`[release-manifest-check] manifestSha256=${result.recorded.manifestSha256}`);
  } catch (error) {
    console.error(`[release-manifest-check] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
