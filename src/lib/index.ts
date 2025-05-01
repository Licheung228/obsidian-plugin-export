import { existsSync } from "node:fs";
import { isAbsolute, parse, relative } from "node:path";
import { rimrafSync } from "rimraf";

/**
 * 判断一个路径是否是另一个路径的子路径
 * @param parent 父路径
 * @param child 子路径
 * @returns 是否是子路径
 */
export function u_path_isChild(parent: string, child: string) {
	const relativePath = relative(parent, child);
	return (
		// 相对路径
		relativePath &&
		// 不是上级目录
		!relativePath.startsWith("..") &&
		// 不是绝对路径
		!isAbsolute(relativePath)
	);
}

/**
 * 获取文件名
 * @param path 路径
 * @returns 文件名
 */
export function u_path_getFilename(path: string) {
	return parse(path).name;
}

/**
 * 清除文件夹下除了 .git / .gitignore 之外的文件
 * @param dir 文件夹路径
 */
export function u_fs_clearDirWithoutGit(
	dir: string,
	warningCb?: () => unknown
) {
	if (!existsSync(dir)) return;
	// 是否需要进行警告
	const agree = warningCb?.();
	if (!agree) return;
	// 如果文件夹下存在内容, 则删除除了 .git / .gitignore 之外的文件
	rimrafSync(dir, {
		glob: {
			dot: true,
			ignore: ["**/.git", "**/.gitignore"],
		},
	});
}
