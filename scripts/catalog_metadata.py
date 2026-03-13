#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import UTC, datetime
from functools import cmp_to_key
from pathlib import Path
from typing import Any

import yaml

SUPPORTED_EXTENSIONS = {".json", ".yaml", ".yml"}
PACKAGE_FILES = {"package.json", "package.yaml", "package.yml"}
CATALOG_INLINE_FILES = {
    "catalog.json",
    "index.json",
    "catalog.yaml",
    "catalog.yml",
    "index.yaml",
    "index.yml",
}
IGNORED_FILES = {"released-bundles.json"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate and audit catalog metadata from extracted operator configs.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_parser = subparsers.add_parser("generate", help="Generate metadata for a single catalog snapshot.")
    generate_parser.add_argument("--catalog-dir", required=True, help="Path to catalog-data/<catalog>/v<version> directory.")
    generate_parser.add_argument("--catalog-type", required=True, help="Catalog type, e.g. certified-operator-index.")
    generate_parser.add_argument("--ocp-version", required=True, help="Catalog version, e.g. v4.20.")
    generate_parser.add_argument("--operators-file", required=True, help="Output path for operators.json.")
    generate_parser.add_argument("--dependencies-file", required=True, help="Output path for dependencies.json.")

    audit_parser = subparsers.add_parser("audit", help="Audit generated metadata against extracted configs.")
    audit_parser.add_argument(
        "--catalog-data-dir",
        default=str(Path.cwd() / "catalog-data"),
        help="Path to catalog-data root.",
    )
    audit_parser.add_argument(
        "--output-dir",
        default=str(Path.cwd() / "audit-reports"),
        help="Output directory for audit reports.",
    )

    return parser.parse_args(argv)


def is_dict(value: Any) -> bool:
    return isinstance(value, dict)


def normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def unique_strings(values: list[str]) -> list[str]:
    return sorted({value for value in values if value})


def compare_versions(left: str, right: str) -> int:
    def base_version(value: str) -> str:
        match = re.match(r"^(\d+\.\d+\.\d+)", value)
        return match.group(1) if match else value

    left_base = base_version(left)
    right_base = base_version(right)

    left_parts = [int(part) for part in left_base.split(".")] if re.match(r"^\d+(?:\.\d+)*$", left_base) else []
    right_parts = [int(part) for part in right_base.split(".")] if re.match(r"^\d+(?:\.\d+)*$", right_base) else []

    max_length = max(len(left_parts), len(right_parts))
    for index in range(max_length):
        left_part = left_parts[index] if index < len(left_parts) else 0
        right_part = right_parts[index] if index < len(right_parts) else 0
        if left_part != right_part:
            return -1 if left_part < right_part else 1

    if left < right:
        return -1
    if left > right:
        return 1
    return 0


def sort_versions(values: list[str]) -> list[str]:
    return sorted({value for value in values if value}, key=cmp_to_key(compare_versions))


def version_range(versions: list[str]) -> dict[str, str | None]:
    if not versions:
        return {"minVersion": None, "maxVersion": None}
    return {"minVersion": versions[0], "maxVersion": versions[-1]}


def extract_version_from_name(name: str) -> str | None:
    patterns = [
        re.compile(r"\.v(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)$"),
        re.compile(r"\.(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)$"),
        re.compile(r"^v?(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)$"),
    ]

    for pattern in patterns:
        match = pattern.search(name)
        if match:
            return match.group(1)

    return None


def parse_json_documents(text: str) -> list[Any]:
    decoder = json.JSONDecoder()
    documents: list[Any] = []
    index = 0
    text_length = len(text)

    while index < text_length:
        while index < text_length and text[index].isspace():
            index += 1

        if index >= text_length:
            break

        document, next_index = decoder.raw_decode(text, index)
        documents.append(document)
        index = next_index

    return documents


def flatten_documents(documents: list[Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for document in documents:
        if isinstance(document, list):
            for item in document:
                if is_dict(item):
                    flattened.append(item)
        elif is_dict(document):
            flattened.append(document)
    return flattened


def load_documents(file_path: Path) -> list[dict[str, Any]]:
    text = file_path.read_text(encoding="utf-8")
    suffix = file_path.suffix.lower()

    if suffix == ".json":
        return flatten_documents(parse_json_documents(text))

    if suffix in {".yaml", ".yml"}:
        return flatten_documents([doc for doc in yaml.safe_load_all(text) if doc is not None])

    return []


def source_category(relative_path: Path) -> str:
    name = relative_path.name.lower()
    parts = [part.lower() for part in relative_path.parts]

    if name in PACKAGE_FILES:
        return "package_explicit"
    if "channels" in parts or name.startswith("channel") or name.startswith("channels"):
        return "channel_explicit"
    if "bundles" in parts or name.startswith("bundle") or name.startswith("bundles"):
        return "bundle_explicit"
    if name in CATALOG_INLINE_FILES:
        return "catalog_inline"
    return "other"


def is_package_doc(document: dict[str, Any], relative_path: Path) -> bool:
    if document.get("schema") == "olm.package":
        return True
    return relative_path.name.lower() in PACKAGE_FILES and bool(normalize_string(document.get("name")))


def is_channel_doc(document: dict[str, Any], relative_path: Path) -> bool:
    if document.get("schema") == "olm.channel":
        return True
    category = source_category(relative_path)
    return category == "channel_explicit" and bool(normalize_string(document.get("name"))) and isinstance(document.get("entries"), list)


def is_bundle_doc(document: dict[str, Any], relative_path: Path) -> bool:
    if document.get("schema") == "olm.bundle":
        return True
    category = source_category(relative_path)
    return category == "bundle_explicit" and bool(normalize_string(document.get("name"))) and isinstance(document.get("properties"), list)


def collect_structured_files(operator_dir: Path) -> list[Path]:
    files: list[Path] = []
    for file_path in sorted(operator_dir.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if file_path.name in IGNORED_FILES:
            continue
        files.append(file_path)
    return files


def normalize_dependencies(dependencies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: dict[tuple[str, str | None], dict[str, Any]] = {}
    for dependency in dependencies:
        package_name = normalize_string(dependency.get("packageName"))
        if not package_name:
            continue

        version_range = dependency.get("versionRange")
        if version_range is None:
            normalized[(package_name, None)] = {"packageName": package_name, "versionRange": None}
        else:
            normalized[(package_name, str(version_range))] = {
                "packageName": package_name,
                "versionRange": str(version_range),
            }

    return [
        normalized[key]
        for key in sorted(normalized.keys(), key=lambda item: (item[0], item[1] or ""))
    ]


def extract_bundle_version(bundle_doc: dict[str, Any]) -> str | None:
    for prop in bundle_doc.get("properties", []) if isinstance(bundle_doc.get("properties"), list) else []:
        if not is_dict(prop):
            continue
        if prop.get("type") == "olm.package" and is_dict(prop.get("value")):
            version = normalize_string(prop["value"].get("version"))
            if version:
                return version

    return extract_version_from_name(normalize_string(bundle_doc.get("name")))


def choose_docs(records: list[dict[str, Any]], preferred_category: str, doc_type: str) -> list[dict[str, Any]]:
    preferred = [record for record in records if record["category"] == preferred_category and record["kind"] == doc_type]
    if preferred:
        return preferred

    fallback = [record for record in records if record["kind"] == doc_type]
    return fallback


def build_operator_metadata(operator_dir: Path, catalog_type: str, ocp_version: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []

    for file_path in collect_structured_files(operator_dir):
        relative_path = file_path.relative_to(operator_dir)
        category = source_category(relative_path)
        try:
            documents = load_documents(file_path)
        except Exception as error:  # noqa: BLE001
            warnings.append(f"{relative_path}: {error}")
            continue

        for document in documents:
            if not is_dict(document):
                continue

            if is_package_doc(document, relative_path):
                records.append({"kind": "package", "category": category, "path": relative_path, "doc": document})
            if is_channel_doc(document, relative_path):
                records.append({"kind": "channel", "category": category, "path": relative_path, "doc": document})
            if is_bundle_doc(document, relative_path):
                records.append({"kind": "bundle", "category": category, "path": relative_path, "doc": document})

    package_records = choose_docs(records, "package_explicit", "package")
    channel_records = choose_docs(records, "channel_explicit", "channel")
    bundle_records = choose_docs(records, "bundle_explicit", "bundle")

    if not package_records and not channel_records and not bundle_records:
        return None, [], warnings

    package_doc = package_records[0]["doc"] if package_records else {}
    operator_name = (
        normalize_string(package_doc.get("name"))
        or next((normalize_string(record["doc"].get("package")) for record in channel_records if normalize_string(record["doc"].get("package"))), "")
        or next((normalize_string(record["doc"].get("package")) for record in bundle_records if normalize_string(record["doc"].get("package"))), "")
        or operator_dir.name
    )
    default_channel = normalize_string(package_doc.get("defaultChannel")) or None

    bundle_by_name: dict[str, dict[str, Any]] = {}
    all_bundle_versions: list[str] = []
    for record in bundle_records:
        bundle_doc = record["doc"]
        bundle_name = normalize_string(bundle_doc.get("name"))
        if not bundle_name:
            continue
        bundle_version = extract_bundle_version(bundle_doc)
        if bundle_version:
            all_bundle_versions.append(bundle_version)
        bundle_by_name[bundle_name] = {
            "doc": bundle_doc,
            "version": bundle_version,
            "path": str(record["path"]),
        }

    channel_docs_by_name: dict[str, list[dict[str, Any]]] = {}
    for record in channel_records:
        channel_name = normalize_string(record["doc"].get("name"))
        if not channel_name:
            continue
        channel_docs_by_name.setdefault(channel_name, []).append(record["doc"])

    channels = unique_strings(list(channel_docs_by_name.keys()))
    if not channels and default_channel:
        channels = [default_channel]

    channel_versions: dict[str, list[str]] = {}
    for channel_name, docs in channel_docs_by_name.items():
        versions: list[str] = []
        for document in docs:
            for entry in document.get("entries", []) if isinstance(document.get("entries"), list) else []:
                if not is_dict(entry):
                    continue
                entry_name = normalize_string(entry.get("name"))
                if not entry_name:
                    continue
                bundle_info = bundle_by_name.get(entry_name)
                version = bundle_info["version"] if bundle_info and bundle_info.get("version") else extract_version_from_name(entry_name)
                if version:
                    versions.append(version)
        channel_versions[channel_name] = sort_versions(versions)

    available_versions = sort_versions(
        [version for versions in channel_versions.values() for version in versions] or all_bundle_versions
    )

    if not channel_versions and default_channel and available_versions:
        channel_versions[default_channel] = available_versions

    for channel_name in channels:
        channel_versions.setdefault(channel_name, [])

    channel_version_ranges = {
        channel_name: version_range(versions)
        for channel_name, versions in sorted(channel_versions.items())
    }

    selected_bundle_doc: dict[str, Any] | None = None
    if default_channel and default_channel in channel_docs_by_name:
        candidate_bundles: list[tuple[str, dict[str, Any]]] = []
        for document in channel_docs_by_name[default_channel]:
            for entry in document.get("entries", []) if isinstance(document.get("entries"), list) else []:
                if not is_dict(entry):
                    continue
                entry_name = normalize_string(entry.get("name"))
                if not entry_name:
                    continue
                bundle_info = bundle_by_name.get(entry_name)
                if bundle_info and bundle_info.get("version"):
                    candidate_bundles.append((bundle_info["version"], bundle_info["doc"]))
        if candidate_bundles:
            candidate_bundles.sort(key=cmp_to_key(lambda left, right: compare_versions(left[0], right[0])))
            selected_bundle_doc = candidate_bundles[-1][1]

    if selected_bundle_doc is None and bundle_by_name:
        bundle_candidates = [
            (info["version"], info["doc"])
            for info in bundle_by_name.values()
            if info.get("version")
        ]
        if bundle_candidates:
            bundle_candidates.sort(key=cmp_to_key(lambda left, right: compare_versions(left[0], right[0])))
            selected_bundle_doc = bundle_candidates[-1][1]

    dependencies: list[dict[str, Any]] = []
    if selected_bundle_doc:
        dependencies = normalize_dependencies([
            {
                "packageName": prop["value"].get("packageName"),
                "versionRange": prop["value"].get("versionRange"),
            }
            for prop in selected_bundle_doc.get("properties", [])
            if is_dict(prop)
            and prop.get("type") == "olm.package.required"
            and is_dict(prop.get("value"))
        ])

    metadata = {
        "name": operator_name,
        "defaultChannel": default_channel,
        "channels": channels,
        "channelVersions": {channel: channel_versions[channel] for channel in sorted(channel_versions)},
        "channelVersionRanges": {channel: channel_version_ranges[channel] for channel in sorted(channel_version_ranges)},
        "availableVersions": available_versions,
        "minVersion": available_versions[0] if available_versions else None,
        "maxVersion": available_versions[-1] if available_versions else None,
        "catalog": catalog_type,
        "ocpVersion": ocp_version,
        "catalogUrl": f"registry.redhat.io/redhat/{catalog_type}:{ocp_version}",
    }

    return metadata, dependencies, warnings


def generate_snapshot_metadata(catalog_dir: Path, catalog_type: str, ocp_version: str) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[str]]:
    configs_dir = catalog_dir / "configs"
    operators: list[dict[str, Any]] = []
    dependencies: dict[str, list[dict[str, Any]]] = {}
    warnings: list[str] = []

    if not configs_dir.is_dir():
        return operators, dependencies, [f"Missing configs directory: {configs_dir}"]

    for operator_dir in sorted(path for path in configs_dir.iterdir() if path.is_dir()):
        metadata, operator_dependencies, operator_warnings = build_operator_metadata(operator_dir, catalog_type, ocp_version)
        warnings.extend(operator_warnings)
        if metadata is None:
            continue
        operators.append(metadata)
        if operator_dependencies:
            dependencies[metadata["name"]] = operator_dependencies

    operators.sort(key=lambda item: item["name"])
    return operators, dependencies, warnings


def write_json(file_path: Path, content: Any) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")


def normalize_operator_for_compare(operator: dict[str, Any]) -> dict[str, Any]:
    normalized_channel_versions = {
        channel: sort_versions(versions if isinstance(versions, list) else [])
        for channel, versions in sorted((operator.get("channelVersions") or {}).items())
    }

    normalized_channel_ranges = {
        channel: {
            "minVersion": value.get("minVersion"),
            "maxVersion": value.get("maxVersion"),
        }
        for channel, value in sorted((operator.get("channelVersionRanges") or {}).items())
        if is_dict(value)
    }

    return {
        "name": operator.get("name"),
        "defaultChannel": operator.get("defaultChannel"),
        "channels": unique_strings(operator.get("channels") or []),
        "channelVersions": normalized_channel_versions,
        "channelVersionRanges": normalized_channel_ranges,
        "availableVersions": sort_versions(operator.get("availableVersions") or []),
        "minVersion": operator.get("minVersion"),
        "maxVersion": operator.get("maxVersion"),
        "catalog": operator.get("catalog"),
        "ocpVersion": operator.get("ocpVersion"),
        "catalogUrl": operator.get("catalogUrl"),
    }


def normalize_dependencies_map(dependencies: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {
        operator_name: normalize_dependencies(values if isinstance(values, list) else [])
        for operator_name, values in sorted(dependencies.items())
    }


def build_markdown_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Fetch Catalogs Metadata Audit Report")
    lines.append("")
    lines.append(f"Generated: {report['generatedAt']}")
    lines.append(f"Catalog data: `{report['catalogDataDir']}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Catalog snapshots audited: {report['summary']['catalogSnapshots']}")
    lines.append(f"- Catalog snapshots with issues: {report['summary']['catalogSnapshotsWithIssues']}")
    lines.append(f"- Operators audited: {report['summary']['operatorsAudited']}")
    lines.append(f"- Operators with issues: {report['summary']['operatorsWithIssues']}")
    lines.append(f"- Total issues: {report['summary']['totalIssues']}")
    lines.append("")
    lines.append("## Issue Counts")
    lines.append("")

    for category, count in sorted(report["summary"]["issueCounts"].items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"- `{category}`: {count}")

    if report.get("notableFindings", {}).get("dellCsm"):
        finding = report["notableFindings"]["dellCsm"]
        lines.append("")
        lines.append("## Dell CSM Example")
        lines.append("")
        lines.append(f"- Catalog: `{finding['catalogKey']}`")
        lines.append(f"- Channels: {', '.join(finding['generated']['channels']) if finding['generated'] else '(none)'}")
        if finding.get("generated"):
            stable_range = finding["generated"].get("channelVersionRanges", {}).get("stable", {})
            lines.append(f"- Generated stable min/max: {stable_range.get('minVersion')} -> {stable_range.get('maxVersion')}")
        lines.append(f"- Issues: {', '.join('`' + issue['category'] + '`' for issue in finding['issues'])}")

    for snapshot in report["snapshots"]:
        if not snapshot["issues"] and not snapshot["operatorFindings"]:
            continue
        lines.append("")
        lines.append(f"## {snapshot['catalogKey']}")
        lines.append("")
        lines.append(f"- Operators audited: {snapshot['operatorCount']}")
        lines.append(f"- Operators with issues: {len(snapshot['operatorFindings'])}")
        if snapshot["issues"]:
            lines.append(f"- Catalog issues: {', '.join('`' + issue['category'] + '`' for issue in snapshot['issues'])}")

        for finding in snapshot["operatorFindings"]:
            categories = ", ".join(f"`{issue['category']}`" for issue in finding["issues"])
            lines.append(
                f"- `{finding['operator']}`: {categories}"
            )

    lines.append("")
    return "\n".join(lines)


def audit_catalog_data(catalog_data_dir: Path, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_counter: Counter[str] = Counter()
    snapshots: list[dict[str, Any]] = []

    master_dependencies_path = catalog_data_dir / "dependencies.json"
    master_dependencies = {}
    if master_dependencies_path.is_file():
        master_dependencies = json.loads(master_dependencies_path.read_text(encoding="utf-8"))

    for catalog_dir in sorted(path for path in catalog_data_dir.iterdir() if path.is_dir()):
        for version_dir in sorted(path for path in catalog_dir.iterdir() if path.is_dir()):
            operators_path = version_dir / "operators.json"
            dependencies_path = version_dir / "dependencies.json"
            if not operators_path.is_file():
                continue

            catalog_type = catalog_dir.name
            ocp_version = version_dir.name
            catalog_key = f"{catalog_type}:{ocp_version}"
            expected_operators, expected_dependencies, warnings = generate_snapshot_metadata(version_dir, catalog_type, ocp_version)
            generated_operators = json.loads(operators_path.read_text(encoding="utf-8"))
            generated_dependencies = (
                json.loads(dependencies_path.read_text(encoding="utf-8"))
                if dependencies_path.is_file()
                else None
            )

            expected_by_name = {operator["name"]: normalize_operator_for_compare(operator) for operator in expected_operators}
            generated_by_name = {operator["name"]: normalize_operator_for_compare(operator) for operator in generated_operators}
            normalized_expected_dependencies = normalize_dependencies_map(expected_dependencies)
            normalized_generated_dependencies = (
                normalize_dependencies_map(generated_dependencies) if is_dict(generated_dependencies) else None
            )

            issues: list[dict[str, Any]] = []
            operator_findings: list[dict[str, Any]] = []

            if normalized_generated_dependencies is None:
                issues.append({"category": "dependencies_file_missing", "details": {"path": str(dependencies_path)}})
                summary_counter["dependencies_file_missing"] += 1

            for warning in warnings:
                issues.append({"category": "parse_warning", "details": {"message": warning}})
                summary_counter["parse_warning"] += 1

            for operator_name in sorted(expected_by_name):
                expected_operator = expected_by_name[operator_name]
                generated_operator = generated_by_name.get(operator_name)
                operator_issues: list[dict[str, Any]] = []

                if generated_operator is None:
                    operator_issues.append({"category": "generated_operator_missing", "details": {}})
                else:
                    if generated_operator["defaultChannel"] != expected_operator["defaultChannel"]:
                        operator_issues.append(
                            {
                                "category": "default_channel_mismatch",
                                "details": {
                                    "expected": expected_operator["defaultChannel"],
                                    "generated": generated_operator["defaultChannel"],
                                },
                            }
                        )
                    if generated_operator["channels"] != expected_operator["channels"]:
                        operator_issues.append(
                            {
                                "category": "channels_mismatch",
                                "details": {
                                    "expected": expected_operator["channels"],
                                    "generated": generated_operator["channels"],
                                },
                            }
                        )
                    if generated_operator["availableVersions"] != expected_operator["availableVersions"]:
                        operator_issues.append(
                            {
                                "category": "available_versions_mismatch",
                                "details": {
                                    "expected": expected_operator["availableVersions"],
                                    "generated": generated_operator["availableVersions"],
                                },
                            }
                        )
                    if generated_operator["minVersion"] != expected_operator["minVersion"] or generated_operator["maxVersion"] != expected_operator["maxVersion"]:
                        operator_issues.append(
                            {
                                "category": "min_max_mismatch",
                                "details": {
                                    "expected": {
                                        "minVersion": expected_operator["minVersion"],
                                        "maxVersion": expected_operator["maxVersion"],
                                    },
                                    "generated": {
                                        "minVersion": generated_operator["minVersion"],
                                        "maxVersion": generated_operator["maxVersion"],
                                    },
                                },
                            }
                        )
                    if generated_operator["channelVersions"] != expected_operator["channelVersions"]:
                        operator_issues.append(
                            {
                                "category": "channel_versions_mismatch",
                                "details": {
                                    "expected": expected_operator["channelVersions"],
                                    "generated": generated_operator["channelVersions"],
                                },
                            }
                        )
                    if generated_operator["channelVersionRanges"] != expected_operator["channelVersionRanges"]:
                        operator_issues.append(
                            {
                                "category": "channel_ranges_mismatch",
                                "details": {
                                    "expected": expected_operator["channelVersionRanges"],
                                    "generated": generated_operator["channelVersionRanges"],
                                },
                            }
                        )

                generated_operator_dependencies = (
                    normalized_generated_dependencies.get(operator_name, []) if normalized_generated_dependencies is not None else []
                )
                expected_operator_dependencies = normalized_expected_dependencies.get(operator_name, [])
                if generated_operator_dependencies != expected_operator_dependencies:
                    operator_issues.append(
                        {
                            "category": "dependencies_mismatch",
                            "details": {
                                "expected": expected_operator_dependencies,
                                "generated": generated_operator_dependencies,
                            },
                        }
                    )

                if operator_issues:
                    for issue in operator_issues:
                        summary_counter[issue["category"]] += 1
                    operator_findings.append(
                        {
                            "operator": operator_name,
                            "issues": operator_issues,
                            "generated": generated_operator,
                            "expected": expected_operator,
                        }
                    )

            for operator_name in sorted(generated_by_name):
                if operator_name in expected_by_name:
                    continue
                summary_counter["generated_operator_unexpected"] += 1
                operator_findings.append(
                    {
                        "operator": operator_name,
                        "issues": [{"category": "generated_operator_unexpected", "details": {}}],
                        "generated": generated_by_name[operator_name],
                        "expected": None,
                    }
                )

            normalized_master_deps = normalize_dependencies_map(master_dependencies.get(catalog_key, {})) if is_dict(master_dependencies.get(catalog_key, {})) else {}
            if normalized_master_deps != normalized_expected_dependencies:
                issues.append(
                    {
                        "category": "master_dependencies_mismatch",
                        "details": {
                            "expected": normalized_expected_dependencies,
                            "generated": normalized_master_deps,
                        },
                    }
                )
                summary_counter["master_dependencies_mismatch"] += 1

            snapshots.append(
                {
                    "catalogKey": catalog_key,
                    "operatorCount": len(expected_operators),
                    "issues": issues,
                    "operatorFindings": operator_findings,
                }
            )

    report = {
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "catalogDataDir": str(catalog_data_dir),
        "summary": {
            "catalogSnapshots": len(snapshots),
            "catalogSnapshotsWithIssues": sum(1 for snapshot in snapshots if snapshot["issues"] or snapshot["operatorFindings"]),
            "operatorsAudited": sum(snapshot["operatorCount"] for snapshot in snapshots),
            "operatorsWithIssues": sum(len(snapshot["operatorFindings"]) for snapshot in snapshots),
            "totalIssues": int(sum(summary_counter.values())),
            "issueCounts": dict(sorted(summary_counter.items())),
        },
        "notableFindings": {
            "dellCsm": next(
                (
                    finding
                    | {"catalogKey": snapshot["catalogKey"]}
                    for snapshot in snapshots
                    for finding in snapshot["operatorFindings"]
                    if snapshot["catalogKey"] == "certified-operator-index:v4.20"
                    and finding["operator"] == "dell-csm-operator-certified"
                ),
                None,
            )
        },
        "snapshots": snapshots,
    }

    json_report_path = output_dir / "fetch-catalogs-audit.json"
    markdown_report_path = output_dir / "fetch-catalogs-audit.md"
    write_json(json_report_path, report)
    markdown_report_path.write_text(build_markdown_report(report), encoding="utf-8")

    print(f"Catalog snapshots audited: {report['summary']['catalogSnapshots']}")
    print(f"Operators audited: {report['summary']['operatorsAudited']}")
    print(f"Operators with issues: {report['summary']['operatorsWithIssues']}")
    print(f"Total issues: {report['summary']['totalIssues']}")
    print(f"JSON report: {json_report_path}")
    print(f"Markdown report: {markdown_report_path}")

    return report


def run_generate(args: argparse.Namespace) -> int:
    catalog_dir = Path(args.catalog_dir)
    operators_file = Path(args.operators_file)
    dependencies_file = Path(args.dependencies_file)
    operators, dependencies, warnings = generate_snapshot_metadata(catalog_dir, args.catalog_type, args.ocp_version)

    write_json(operators_file, operators)
    write_json(dependencies_file, dependencies)

    if warnings:
        for warning in warnings:
            print(f"[WARNING] {warning}", file=sys.stderr)

    print(f"Generated metadata for {len(operators)} operators", file=sys.stderr)
    print(f"Generated dependencies for {len(dependencies)} operators", file=sys.stderr)
    return 0


def run_audit(args: argparse.Namespace) -> int:
    audit_catalog_data(Path(args.catalog_data_dir), Path(args.output_dir))
    return 0


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.command == "generate":
        return run_generate(args)
    return run_audit(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
