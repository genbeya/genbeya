import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { describeLocation, type Location } from "../../shared/api";
import { api } from "../api";
import { Dialog } from "../components/Dialog";
import { Button } from "../components/controls";

type Kind = "wsl" | "ssh";

function RemoteFields({
  kind,
  setKind,
  distro,
  setDistro,
  host,
  setHost,
  path,
  setPath,
  pathLabel,
}: {
  kind: Kind;
  setKind(k: Kind): void;
  distro: string;
  setDistro(v: string): void;
  host: string;
  setHost(v: string): void;
  path: string;
  setPath(v: string): void;
  pathLabel: string;
}) {
  const [distros, setDistros] = useState<string[] | null>(null);
  useEffect(() => {
    void api()
      .wslDistros()
      .then((list) => {
        setDistros(list);
        if (list.length && !distro) setDistro(list[0]);
        if (!list.length) setKind("ssh");
      });
  }, []);
  return (
    <>
      <div className="segmented" role="tablist">
        <button type="button" className={kind === "wsl" ? "is-active" : ""} disabled={!distros?.length} onClick={() => setKind("wsl")}>
          WSL
        </button>
        <button type="button" className={kind === "ssh" ? "is-active" : ""} onClick={() => setKind("ssh")}>
          SSH
        </button>
      </div>
      {kind === "wsl" ? (
        <label className="field">
          Distribution
          <select className="select" value={distro} onChange={(e) => setDistro(e.target.value)}>
            {distros?.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
      ) : (
        <label className="field">
          Host
          <input
            className="input"
            value={host}
            spellCheck={false}
            placeholder="user@server or a Host from ~/.ssh/config"
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        {pathLabel}
        <input
          className="input mono"
          value={path}
          spellCheck={false}
          placeholder="/home/me/project"
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
    </>
  );
}

const location = (kind: Kind, distro: string, host: string, path: string): Location =>
  kind === "wsl" ? { kind, distro, path: path.trim() } : { kind, host: host.trim(), path: path.trim() };

export function RemoteDialog({ onClose, onOpen }: { onClose(): void; onOpen(location: Location): void }) {
  const [kind, setKind] = useState<Kind>("wsl");
  const [distro, setDistro] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const valid = path.trim().startsWith("/") && (kind === "wsl" ? !!distro : !!host.trim());
  const submit = () => valid && onOpen(location(kind, distro, host, path));
  return (
    <Dialog
      title="Open a repository on WSL or SSH"
      onClose={onClose}
      onSubmit={submit}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Open
          </Button>
        </>
      }
    >
      <RemoteFields {...{ kind, setKind, distro, setDistro, host, setHost, path, setPath }} pathLabel="Repository path" />
      <p className="dialog-hint">
        Git runs on the remote machine. SSH uses your <code>ssh</code> configuration and agent; connect once in a
        terminal so the host key is trusted.
      </p>
    </Dialog>
  );
}

export function CloneDialog({ onClose, onClone }: { onClose(): void; onClone(url: string, parent: Location): void }) {
  const [url, setUrl] = useState("");
  const [where, setWhere] = useState<"local" | Kind>("local");
  const [folder, setFolder] = useState<Location | null>(null);
  const [kind, setKind] = useState<Kind>("wsl");
  const [distro, setDistro] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const parent: Location | null =
    where === "local" ? folder : path.trim().startsWith("/") ? location(kind, distro, host, path) : null;
  const valid = !!url.trim() && !!parent;
  return (
    <Dialog
      title="Clone a repository"
      onClose={onClose}
      onSubmit={() => valid && onClone(url.trim(), parent!)}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Clone
          </Button>
        </>
      }
    >
      <label className="field">
        Repository URL
        <input
          className="input mono"
          autoFocus
          value={url}
          spellCheck={false}
          placeholder="git@github.com:team/project.git"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className="segmented">
        <button type="button" className={where === "local" ? "is-active" : ""} onClick={() => setWhere("local")}>
          This computer
        </button>
        <button type="button" className={where !== "local" ? "is-active" : ""} onClick={() => setWhere(kind)}>
          WSL or SSH
        </button>
      </div>
      {where === "local" ? (
        <div className="field">
          Into folder
          <div className="row">
            <input className="input mono grow" readOnly value={folder ? describeLocation(folder) : ""} placeholder="Choose a parent folder" />
            <Button icon={<FolderOpen size={14} />} onClick={() => void api().pickFolder().then((l) => l && setFolder(l))}>
              Choose…
            </Button>
          </div>
        </div>
      ) : (
        <RemoteFields
          {...{ kind, distro, setDistro, host, setHost, path, setPath }}
          setKind={(k) => {
            setKind(k);
            setWhere(k);
          }}
          pathLabel="Into folder"
        />
      )}
      <p className="dialog-hint">Authentication uses your existing Git credentials and SSH keys.</p>
    </Dialog>
  );
}
