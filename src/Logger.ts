export default class Logger {
    public constructor(private debug: boolean, private id?: string) {}

    public withId(id: string) {
        return new Logger(this.debug, id);
    }

    public log(...messages: any[]) {
        if (this.debug) {
            console.log(`[${this.id ?? "system"}]`, ...messages);
        }
    }
}