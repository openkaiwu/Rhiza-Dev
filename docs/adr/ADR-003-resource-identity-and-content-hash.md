# ADR-003: Resource identity、规范化与内容哈希

- Status: Accepted
- Date: 2026-08-23
- Baseline: Rhiza Architecture & Roadmap Baseline V4.0, M01
- Carried forward: V4.2; implementation accepted through M04 evidence
- Supersedes: none
- Superseded by: none

## Context

作出本决策时，附件由路由直接写入 `var/uploads/`，没有内容寻址、版本或可移植 identity。V4.0 I-08/I-09 与 §9 要求 Resource identity 与位置解耦，避免绝对路径、数据库 row id、OS 分隔符或 URL 改变破坏 provenance。M04 已以 Resource/ResourceVersion、SHA-256 与 content-addressed BlobStore 落地该决策。

## Decision

M04 的 ResourceVersion 使用规范化内容的 cryptographic digest 作为内容 identity，并以稳定 Resource/ResourceVersion ref 表达逻辑身份。字节规范化、MIME/media-type canonicalization、digest algorithm 与 schema/contract version 必须随 ResourceVersion 保存；相同逻辑 Resource 的新内容创建新版本，不改写旧版本。绝对路径、URL、Git remote、上传文件名等仅存为 `origin_metadata`，不参与 identity 或 equality。

哈希覆盖规范化后的 blob bytes；任何读取或导入必须复算并验证 digest。可删除正文或敏感内容只在加密 Blob 中保存，Journal/Manifest 只保存 `blob_ref + digest`。

## Alternatives considered

- 用上传路径或数据库自增 id 做 identity：不可移植且位置变化会破坏引用，拒绝。
- 只保存文件名加 size：不能可靠识别内容或篡改，拒绝。
- 把所有文本强制转 UTF-8 后哈希：会破坏二进制资源，拒绝；规范化按 media type 版本化执行。

## Consequences

上传、导入、Bundle 和 Context Manifest 需要保存 version/digest/compiler 信息；重复内容可去重存储但仍保留各自 origin metadata。消费者不得以本机路径恢复历史事实。hash algorithm 或 canonicalizer 的破坏性变更需新 contract major 并支持旧版本校验。

## Migration and rollback

M04 先新增 Blob/ResourceVersion 表与双写，回填现有附件的 digest 和 origin metadata，然后切换读取到 refs；无法读取的遗留文件标记为 migration error，不能伪造 digest。回滚时使用旧附件路径读取，同时保留新表和回填映射；不删除已生成 Blob。

## Supersession

hash algorithm、canonicalization contract 或 portable resource format 的变化必须以 ADR supersede；增加新的 media-type canonicalizer 只要保留旧版本解析即可不 supersede。
