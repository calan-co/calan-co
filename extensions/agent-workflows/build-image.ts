import { execFile as nodeExecFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type SandcastleImageProvider = "docker" | "podman";

export interface ExecFileResult {
	stdout: string;
	stderr: string;
}

export type ExecFileLike = (command: string, args: string[], options: { cwd: string }) => Promise<ExecFileResult>;

export interface BuildSandcastleImageOptions {
	cwd: string;
	provider: SandcastleImageProvider;
	imageName: string;
	containerfile?: string;
	execFile?: ExecFileLike;
}

export function defaultUidBuildArgs(): Record<string, string> {
	const args: Record<string, string> = {};
	const uid = process.getuid?.();
	const gid = process.getgid?.();
	if (uid !== undefined) args.AGENT_UID = String(uid);
	if (gid !== undefined) args.AGENT_GID = String(gid);
	return args;
}

export function resolveBuildSandcastleImageCommand(options: BuildSandcastleImageOptions): { command: string; args: string[]; cwd: string } {
	const { cwd, provider, imageName } = options;
	const sandcastleDir = join(cwd, ".sandcastle");
	const fallbackFile = provider === "docker" ? join(sandcastleDir, "Dockerfile") : join(sandcastleDir, "Containerfile");
	const alternateFile = provider === "docker" ? join(sandcastleDir, "Containerfile") : join(sandcastleDir, "Dockerfile");
	const explicitFile = options.containerfile;
	const selectedFile = explicitFile || (existsSync(fallbackFile) ? undefined : existsSync(alternateFile) ? alternateFile : undefined);
	const buildArgs = provider === "docker"
		? Object.entries(defaultUidBuildArgs()).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`])
		: [];

	if (selectedFile) {
		return {
			command: provider,
			args: ["build", "-t", imageName, ...buildArgs, "-f", resolve(selectedFile), cwd],
			cwd,
		};
	}

	return {
		command: provider,
		args: ["build", "-t", imageName, ...buildArgs, resolve(sandcastleDir)],
		cwd,
	};
}

export function defaultExecFile(command: string, args: string[], options: { cwd: string }): Promise<ExecFileResult> {
	return new Promise((resolvePromise, reject) => {
		nodeExecFile(command, args, { cwd: options.cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`${command} ${args[0] || ""} failed: ${stderr?.toString() || error.message}`));
				return;
			}
			resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString() });
		});
	});
}

export async function buildSandcastleImage(options: BuildSandcastleImageOptions): Promise<void> {
	if (!existsSync(join(options.cwd, ".sandcastle"))) throw new Error("Sandcastle CLI scaffold is missing: .sandcastle/.");
	const execFile = options.execFile || defaultExecFile;
	const command = resolveBuildSandcastleImageCommand(options);
	await execFile(command.command, command.args, { cwd: command.cwd });
}
