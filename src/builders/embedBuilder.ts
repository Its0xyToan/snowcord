import type {
    APIEmbed,
    APIEmbedAuthor,
    APIEmbedField,
    APIEmbedFooter,
    APIEmbedImage,
    APIEmbedProvider,
    APIEmbedThumbnail,
    APIEmbedVideo,
    EmbedType,
} from "../types/discord.js";

type EmbedTimestampInput = Date | number | string;

const normalizeTimestamp = (input: EmbedTimestampInput): string => {
    if (input instanceof Date) return input.toISOString();
    if (typeof input === "number") return new Date(input).toISOString();
    return input;
};

export class EmbedBuilder {
    private readonly data: APIEmbed;

    constructor(initial?: Partial<APIEmbed>) {
        this.data = { ...(initial ?? {}) };
    }

    patch(value: Partial<APIEmbed>): this {
        Object.assign(this.data, value);
        return this;
    }

    type(value: EmbedType): this {
        this.data.type = value;
        return this;
    }

    title(value: string): this {
        this.data.title = value;
        return this;
    }

    description(value: string): this {
        this.data.description = value;
        return this;
    }

    url(value: string): this {
        this.data.url = value;
        return this;
    }

    timestamp(value: EmbedTimestampInput): this {
        this.data.timestamp = normalizeTimestamp(value);
        return this;
    }

    color(value: number): this {
        this.data.color = value;
        return this;
    }

    author(value: APIEmbedAuthor): this {
        this.data.author = { ...value };
        return this;
    }

    footer(value: APIEmbedFooter): this {
        this.data.footer = { ...value };
        return this;
    }

    image(value: APIEmbedImage | string): this {
        this.data.image = typeof value === "string" ? { url: value } : { ...value };
        return this;
    }

    thumbnail(value: APIEmbedThumbnail | string): this {
        this.data.thumbnail = typeof value === "string" ? { url: value } : { ...value };
        return this;
    }

    video(value: APIEmbedVideo): this {
        this.data.video = { ...value };
        return this;
    }

    provider(value: APIEmbedProvider): this {
        this.data.provider = { ...value };
        return this;
    }

    field(name: string, value: string, inline = false): this {
        if (!this.data.fields) this.data.fields = [];
        this.data.fields.push({ name, value, inline });
        return this;
    }

    fields(value: APIEmbedField[]): this {
        this.data.fields = value.map((field) => ({ ...field }));
        return this;
    }

    addFields(...value: APIEmbedField[]): this {
        if (!this.data.fields) this.data.fields = [];
        this.data.fields.push(...value.map((field) => ({ ...field })));
        return this;
    }

    clearFields(): this {
        this.data.fields = [];
        return this;
    }

    build(): APIEmbed {
        return {
            ...this.data,
            author: this.data.author ? { ...this.data.author } : undefined,
            footer: this.data.footer ? { ...this.data.footer } : undefined,
            image: this.data.image ? { ...this.data.image } : undefined,
            thumbnail: this.data.thumbnail ? { ...this.data.thumbnail } : undefined,
            video: this.data.video ? { ...this.data.video } : undefined,
            provider: this.data.provider ? { ...this.data.provider } : undefined,
            fields: this.data.fields?.map((field) => ({ ...field })),
        };
    }

    toJSON(): APIEmbed {
        return this.build();
    }
}

export const buildEmbed = (initial?: Partial<APIEmbed>): EmbedBuilder =>
    new EmbedBuilder(initial);
