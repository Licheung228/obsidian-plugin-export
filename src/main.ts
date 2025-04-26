import {
	Plugin,
	TFile,
	FileSystemAdapter,
	App,
	Modal,
	Setting,
	Notice,
} from "obsidian";
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { copy, outputFile } from "fs-extra";
import { u_fs_clearDirWithoutGit, u_path_isChild } from "./lib";

export default class ExportPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: "export-obsidian-notes",
			name: "导出笔记",
			callback: () => {
				this.activateView();
			},
		});
	}

	async activateView() {
		const modal = new ExportModal(this.app);
		modal.open();
	}
}

export class InputModal extends Modal {
	input1: HTMLInputElement;
	input2: HTMLInputElement;

	constructor(app: App) {
		super(app);

		const { contentEl } = this;

		contentEl.createEl("h3", { text: "Input tag" });

		// tag
		new Setting(contentEl).setName("Tags").addText((text) => {
			this.input1 = text.inputEl;
			text.setPlaceholder("input tags");
		});

		// export dirname
		new Setting(contentEl).setName("export dir").addText((text) => {
			this.input2 = text.inputEl;
			text.setPlaceholder("input export dir");
		});

		// 按钮组
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("确认")
					.setCta()
					.onClick(async () => {
						await this.onSubmit(
							this.input1.value,
							this.input2.value
						);
						new Notice("导出成功");
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("取消")
					.setTooltip("取消")
					.onClick(() => this.close())
			);
	}

	onSubmit(..._args: string[]): unknown | Promise<unknown> {
		return "";
	}

	onClose() {
		this.contentEl.empty();
	}
}

class ExportModal extends InputModal {
	// 默认导出文件夹名称
	static DEFAULT_EXPORT_DIR = "__LIK_EXPORT__";
	// 当前vault path
	vaultBasePath: string;
	// 导出路径
	exportDir: string;
	// 警告元素
	warningEl: HTMLParagraphElement;

	constructor(app: App) {
		super(app);

		// 初始化 vaultBasePath, exportDir
		this.vaultBasePath = (
			this.app.vault.adapter as FileSystemAdapter
		).getBasePath();
		this.setExportDirPath();
	}

	onOpen() {
		this.warningEl = this.contentEl.createEl("p", {
			text: "Warning: export dir already exists, will be cleared",
		});
		this.warningEl.style.color = "red";
		this.warningEl.style.display = "none";

		// 如果导出目录存在, 则显示警告
		this.input2.addEventListener("input", (e: Event) => {
			const { value } = e.target as HTMLInputElement;
			const exportDir = isAbsolute(value)
				? value
				: resolve(this.vaultBasePath, value);
			const isExist = existsSync(exportDir);
			this.warningEl.style.display = isExist ? "block" : "none";
		});
	}

	setExportDirPath(dirname: string = ExportModal.DEFAULT_EXPORT_DIR) {
		this.exportDir = isAbsolute(dirname)
			? dirname // 如果是绝对路径, 则无需resolve
			: resolve(this.vaultBasePath, dirname); // 如果是相对路径, 则需要resolve, 根路径为obsidian当前vault的根目录
	}

	onSubmit(query: string, dirname?: string) {
		// 如果指定了导出目录, 则设置导出目录
		if (dirname) this.setExportDirPath(dirname);
		// 清除旧的导出内容
		u_fs_clearDirWithoutGit(resolve(this.exportDir, "**"));
		// 创建导出目录
		mkdirSync(this.exportDir, { recursive: true });
		// 遍历所有文件
		this.app.vault.getFiles().forEach(async (file: TFile) => {
			// 获取源文件路径
			const originFilePath = resolve(this.vaultBasePath, file.path);
			// 如果导出文件路径是导出目录的子目录, 则跳过
			if (u_path_isChild(this.exportDir, originFilePath)) return;
			// 获取头
			const metadataCache = this.app.metadataCache.getFileCache(file);
			// 是否匹配
			const isMatch =
				metadataCache?.frontmatter?.tags &&
				metadataCache?.frontmatter?.tags.includes(query);
			// 不匹配跳过
			if (!isMatch) return;
			// 获取导出文件路径
			const exportFilePath = resolve(this.exportDir, file.path);
			// 如果不存在链接或者嵌入, 则直接把源文件复制到导出目录
			if (!metadataCache?.links && !metadataCache?.embeds) {
				return copy(originFilePath, exportFilePath);
			}
			// 从缓存读取应当被处理的文章
			// 这里使用 cacheRead, 见文章
			const content = await this.app.vault.cachedRead(file);
			// 如果没有任何内容, 则直接复制源文件到导出目录
			if (!content) return copy(originFilePath, exportFilePath);
			// 替换obsidian语法为标准markdown语法
			const replaced = content.replace(
				// 匹配obsidian语法 ( ![[embeb]] / [[link]] )
				/(!)?\[\[([^\]]+)\]\]/g,
				(_match, isEmbed, target) => {
					// 处理链接 (如果存在 | 则说明是有同名的, 需要处理一下)
					if (target.includes("|")) {
						const arr = target.split("|").slice(0, -1);
						target = arr.join("|");
					}
					// 获取链接目标, 主要是拿地址和文件名称
					const linkPathDest =
						this.app.metadataCache.getFirstLinkpathDest(
							target,
							file.path
						);
					// 如果没查到可能是文件被删掉了, 直接return即可
					if (!linkPathDest) return "";
					const { path, basename } = linkPathDest;
					// todo 这里不合理, 不应当在替换动作中掺入其他副作用
					if (isEmbed) {
						// 处理 embed. 主要是图片资源, 把图片资源导出到根目录下
						copy(
							resolve(this.vaultBasePath, path),
							resolve(this.exportDir, path)
						);
					}
					// 防止空格字符, 导致无法索引到正常的资源
					const _path = isEmbed ? path.replace(/\s+/g, "%20") : path;
					return `${isEmbed ? "!" : ""}[${basename}](${_path})`;
				}
			);

			// 写入导出文件
			outputFile(exportFilePath, replaced);
		});
	}
}
