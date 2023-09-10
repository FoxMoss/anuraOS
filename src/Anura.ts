class Anura {
    version = {
        semantic: {
            major: "1",
            minor: "0",
            patch: "0",
        },
        buildstate: "alpha",
        codename: "Lag Train",
        get pretty() {
            const semantic = anura.version.semantic;
            return `${semantic.major}.${semantic.minor}.${semantic.patch} ${anura.version.buildstate}`;
        },
    };
    initComplete = false;
    x86: null | V86Backend;
    settings: Settings;
    fs: FilerFS;
    config: any;
    notifications: NotificationService;
    x86hdd: FakeFile;

    private constructor(
        fs: FilerFS,
        settings: Settings,
        config: any,
        hdd: FakeFile,
    ) {
        this.fs = fs;
        this.settings = settings;
        this.config = config;
        this.x86hdd = hdd;

        this.notifications = new NotificationService();
        document.body.appendChild(this.notifications.element);
    }

    static async new(config: any): Promise<Anura> {
        // File System Initialization //
        const fs = new Filer.FileSystem({
            name: "anura-mainContext",
            provider: new Filer.FileSystem.providers.IndexedDB(),
        });

        // don't like this... but whatever
        // Neither do I, preferably, I'd wrap all the FS things in another way, this is just to make python "workish"
        fs.readFileSync = async (path: string) => {
            return await new Promise((resolve, reject) => {
                return fs.readFile(path, function async(err: any, data: any) {
                    resolve(new TextDecoder("utf8").decode(data));
                });
            });
        };

        const settings = await Settings.new(fs, config.defaultsettings);

        const hdd = await InitV86Hdd();
        const anuraPartial = new Anura(fs, settings, config, hdd);
        return anuraPartial;
    }

    wm = new WMAPI();

    apps: any = {};
    logger = {
        log: console.log.bind(console, "anuraOS:"),
        debug: console.debug.bind(console, "anuraOS:"),
        warn: console.warn.bind(console, "anuraOS:"),
        error: console.error.bind(console, "anuraOS:"),
    };
    // net = new Networking();

    async registerApp(app: App) {
        if (app.package in this.apps) {
            throw "Application already installed";
        }

        launcher.addShortcut(app);

        this.apps[app.package] = app;

        if (this.initComplete) {
            taskbar.updateTaskbar();
            alttab.update();
        }
        return app;
    }
    async unregisterApp(app: App) {
        if (!(app.package in this.apps)) {
            throw "Application not installed";
        }

        launcher.delShortcut(app);

        delete this.apps[app.package];

        if (this.initComplete) {
            taskbar.updateTaskbar();
            alttab.update();
        }
        return app;
    }
    async registerExternalApp(source: string): Promise<ExternalApp> {
        const resp = await fetch(`${source}/manifest.json`);
        const manifest = await resp.json();
        const app = new ExternalApp(manifest, source);
        await anura.registerApp(app); // This will let us capture error messages
        return app;
    }
    ContextMenu = ContextMenuAPI;
    removeStaleApps() {
        for (const appName in anura.apps) {
            const app = anura.apps[appName];
            app.windows.forEach((win: any) => {
                if (!win.element.parentElement) {
                    app.windows.splice(app.windows.indexOf(win));
                }
            });
        }
        taskbar.updateTaskbar();
        alttab.update();
    }
    files = new FilesAPI();
    async python(appname: string) {
        return await new Promise((resolve, reject) => {
            const iframe = document.createElement("iframe");
            iframe.setAttribute("style", "display: none");
            iframe.setAttribute("src", "/apps/python.app/lib.html");
            iframe.id = appname;
            iframe.onload = async function () {
                console.log("Called from python");
                //@ts-ignore
                const pythonInterpreter = await document
                    //@ts-ignore
                    .getElementById(appname)
                    //@ts-ignore
                    .contentWindow.loadPyodide({
                        stdin: () => {
                            const result = prompt();
                            //@ts-ignore
                            echo(result);
                            return result;
                        },
                    });
                pythonInterpreter.globals.set("AliceWM", AliceWM);
                pythonInterpreter.globals.set("anura", anura);
                //@ts-ignore
                pythonInterpreter.window = (<any>(
                    document.getElementById(appname)
                )).contentWindow;
                resolve(pythonInterpreter);
            };
            document.body.appendChild(iframe);
        });
    }
    get wsproxyURL() {
        return this.settings.get("wsproxy-url");
    }
}

interface AppManifest {
    name: string;
    type: "manual" | "auto";
    package: string;
    index?: string;
    icon: string;
    handler?: string;
    background?: string;
    wininfo: string | WindowInformation;
}
