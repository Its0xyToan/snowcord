import { MessageComponent } from "@discordeno/bot";
import { ButtonStyle, ComponentType, TextInputStyle } from "../types/discord.js";
import { registerComponentExecutor, registerModalExecutor } from "../core/interactionRefs.js";
import type {
    APIActionRowComponent,
    APIButtonComponent,
    APIButtonComponentWithCustomId,
    APIButtonComponentWithSKUId,
    APIButtonComponentWithURL,
    APIChannelSelectComponent,
    APIComponentInContainer,
    APIComponentInMessageActionRow,
    APIContainerComponent,
    APIFileComponent,
    APIMediaGalleryComponent,
    APIMediaGalleryItem,
    APIModalInteractionResponseCallbackData,
    APIMessageComponentEmoji,
    APIMessageTopLevelComponent,
    APIMentionableSelectComponent,
    APIRoleSelectComponent,
    APISectionAccessoryComponent,
    APISectionComponent,
    APISelectMenuOption,
    APISeparatorComponent,
    APIStringSelectComponent,
    APITextDisplayComponent,
    APITextInputComponent,
    APIThumbnailComponent,
    APIUnfurledMediaItem,
    APIUserSelectComponent,
    ChannelType,
    SeparatorSpacingSize,
    Snowflake,
} from "../types/discord.js";
import type { SnowcordInteractionExecutor } from "../types/types.js";

type BuilderCallback<TBuilder> = (builder: TBuilder) => void;

type ButtonInput = APIButtonComponent | BuilderCallback<ButtonBuilder>;
type StringSelectInput = APIStringSelectComponent | BuilderCallback<StringSelectMenuBuilder>;
type UserSelectInput = APIUserSelectComponent | BuilderCallback<UserSelectMenuBuilder>;
type RoleSelectInput = APIRoleSelectComponent | BuilderCallback<RoleSelectMenuBuilder>;
type MentionableSelectInput = APIMentionableSelectComponent | BuilderCallback<MentionableSelectMenuBuilder>;
type ChannelSelectInput = APIChannelSelectComponent | BuilderCallback<ChannelSelectMenuBuilder>;
type TextDisplayInput = APITextDisplayComponent | string | BuilderCallback<TextDisplayBuilder>;
type SectionInput = APISectionComponent | BuilderCallback<SectionBuilder>;
type ContainerInput = APIContainerComponent | BuilderCallback<ContainerBuilder>;
type ActionRowInput = APIActionRowComponent<APIComponentInMessageActionRow> | BuilderCallback<ActionRowBuilder>;
type ThumbnailInput = APIThumbnailComponent | BuilderCallback<ThumbnailBuilder>;
type AccessoryInput = APISectionAccessoryComponent | BuilderCallback<AccessoryBuilder>;
type FileInput = APIFileComponent | BuilderCallback<FileBuilder>;
type MediaGalleryInput = APIMediaGalleryComponent | BuilderCallback<MediaGalleryBuilder>;
type SeparatorInput = APISeparatorComponent | BuilderCallback<SeparatorBuilder>;
type TextInputInput = APITextInputComponent | BuilderCallback<TextInputBuilder>;
type ModalActionRowInput = APIActionRowComponent<APITextInputComponent> | BuilderCallback<ModalActionRowBuilder>;

let componentCounter = 0;

const nextCustomId = (prefix: string): string =>
    `snowcord:${prefix}:${Date.now().toString(36)}:${(componentCounter++).toString(36)}`;

const cloneMediaItem = (item: APIUnfurledMediaItem): APIUnfurledMediaItem => ({ ...item });
const cloneTextInputComponent = (component: APITextInputComponent): APITextInputComponent => ({ ...component });
const cloneModalActionRow = (
    row: APIActionRowComponent<APITextInputComponent>
): APIActionRowComponent<APITextInputComponent> => ({
    ...row,
    components: row.components.map((component) => cloneTextInputComponent(component)),
});

export class ButtonBuilder {
    private data: {
        id?: number;
        style: ButtonStyle;
        disabled?: boolean;
        label?: string;
        emoji?: APIMessageComponentEmoji;
        custom_id?: string;
        url?: string;
        sku_id?: Snowflake;
    };
    private executorValue: SnowcordInteractionExecutor | undefined;

    constructor(initial?: Partial<APIButtonComponent>) {
        this.data = {
            style: ButtonStyle.Secondary,
            custom_id: nextCustomId("button"),
            ...(initial as Partial<APIButtonComponentWithCustomId>),
        };
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    style(value: ButtonStyle): this {
        this.data.style = value;
        return this;
    }

    primary(): this {
        return this.style(ButtonStyle.Primary);
    }

    secondary(): this {
        return this.style(ButtonStyle.Secondary);
    }

    success(): this {
        return this.style(ButtonStyle.Success);
    }

    danger(): this {
        return this.style(ButtonStyle.Danger);
    }

    link(url?: string): this {
        this.data.style = ButtonStyle.Link;
        this.data.url = url ?? this.data.url ?? "https://discord.com";
        return this;
    }

    premium(skuId: Snowflake): this {
        this.data.style = ButtonStyle.Premium;
        this.data.sku_id = skuId;
        return this;
    }

    label(value: string): this {
        this.data.label = value;
        return this;
    }

    emoji(value: APIMessageComponentEmoji): this {
        this.data.emoji = { ...value };
        return this;
    }

    disabled(value = true): this {
        this.data.disabled = value;
        return this;
    }

    customId(value: string): this {
        this.data.custom_id = value;
        if (this.data.style === ButtonStyle.Link || this.data.style === ButtonStyle.Premium) {
            this.data.style = ButtonStyle.Secondary;
        }
        return this;
    }

    ref(value: string): this {
        return this.customId(value);
    }

    url(value: string): this {
        this.data.style = ButtonStyle.Link;
        this.data.url = value;
        return this;
    }

    skuId(value: Snowflake): this {
        this.data.style = ButtonStyle.Premium;
        this.data.sku_id = value;
        return this;
    }

    execute(handler: SnowcordInteractionExecutor): this {
        this.executorValue = handler;
        return this;
    }

    build(): APIButtonComponent {
        if (this.data.style === ButtonStyle.Link) {
            if (this.executorValue) {
                throw new Error("Link buttons cannot have execute handlers.");
            }
            return {
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                id: this.data.id,
                disabled: this.data.disabled,
                label: this.data.label,
                emoji: this.data.emoji ? { ...this.data.emoji } : undefined,
                url: this.data.url ?? "https://discord.com",
            } satisfies APIButtonComponentWithURL;
        }

        if (this.data.style === ButtonStyle.Premium) {
            if (this.executorValue) {
                throw new Error("Premium buttons cannot have execute handlers.");
            }
            if (!this.data.sku_id) {
                throw new Error("Premium buttons require sku_id.");
            }

            return {
                type: ComponentType.Button,
                style: ButtonStyle.Premium,
                id: this.data.id,
                disabled: this.data.disabled,
                sku_id: this.data.sku_id,
            } satisfies APIButtonComponentWithSKUId;
        }

        const style =
            this.data.style === ButtonStyle.Primary ||
                this.data.style === ButtonStyle.Secondary ||
                this.data.style === ButtonStyle.Success ||
                this.data.style === ButtonStyle.Danger
                ? this.data.style
                : ButtonStyle.Secondary;
        const customId = this.data.custom_id ?? nextCustomId("button");
        if (this.executorValue) {
            registerComponentExecutor(customId, this.executorValue);
        }

        return {
            type: ComponentType.Button,
            style,
            id: this.data.id,
            disabled: this.data.disabled,
            label: this.data.label,
            emoji: this.data.emoji ? { ...this.data.emoji } : undefined,
            custom_id: customId,
        } satisfies APIButtonComponentWithCustomId;
    }

    toJSON(): APIButtonComponent {
        return this.build();
    }
}

export class StringSelectMenuBuilder {
    private data: Omit<APIStringSelectComponent, "type"> & { id?: number };
    private executorValue: SnowcordInteractionExecutor | undefined;

    constructor(initial?: Partial<APIStringSelectComponent>) {
        this.data = {
            custom_id: nextCustomId("string-select"),
            options: [{ label: "Option 1", value: "option_1" }],
            ...(initial ?? {}),
        };
        if (initial?.options) {
            this.data.options = initial.options.map((option) => ({ ...option }));
        }
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    customId(value: string): this {
        this.data.custom_id = value;
        return this;
    }

    ref(value: string): this {
        return this.customId(value);
    }

    placeholder(value: string): this {
        this.data.placeholder = value;
        return this;
    }

    minValues(value: number): this {
        this.data.min_values = value;
        return this;
    }

    maxValues(value: number): this {
        this.data.max_values = value;
        return this;
    }

    disabled(value = true): this {
        this.data.disabled = value;
        return this;
    }

    required(value = true): this {
        this.data.required = value;
        return this;
    }

    options(value: APISelectMenuOption[]): this {
        this.data.options = value.map((option) => ({ ...option }));
        return this;
    }

    option(value: APISelectMenuOption): this {
        this.data.options.push({ ...value });
        return this;
    }

    execute(handler: SnowcordInteractionExecutor): this {
        this.executorValue = handler;
        return this;
    }

    build(): APIStringSelectComponent {
        const options =
            this.data.options.length > 0
                ? this.data.options.map((option) => ({ ...option }))
                : [{ label: "Option 1", value: "option_1" }];
        const customId = this.data.custom_id ?? nextCustomId("string-select");
        if (this.executorValue) {
            registerComponentExecutor(customId, this.executorValue);
        }

        return {
            ...this.data,
            custom_id: customId,
            type: ComponentType.StringSelect,
            options,
        };
    }

    toJSON(): APIStringSelectComponent {
        return this.build();
    }
}

class BaseAutoSelectMenuBuilder<T extends APIUserSelectComponent | APIRoleSelectComponent | APIMentionableSelectComponent | APIChannelSelectComponent> {
    protected data: T;
    private executorValue: SnowcordInteractionExecutor | undefined;

    constructor(type: T["type"], initial?: Partial<T>) {
        this.data = {
            type,
            custom_id: nextCustomId("auto-select"),
            ...(initial ?? {}),
        } as T;
        if (initial?.default_values) {
            this.data.default_values = [...initial.default_values] as T["default_values"];
        }
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    customId(value: string): this {
        this.data.custom_id = value;
        return this;
    }

    ref(value: string): this {
        return this.customId(value);
    }

    placeholder(value: string): this {
        this.data.placeholder = value;
        return this;
    }

    minValues(value: number): this {
        this.data.min_values = value;
        return this;
    }

    maxValues(value: number): this {
        this.data.max_values = value;
        return this;
    }

    disabled(value = true): this {
        this.data.disabled = value;
        return this;
    }

    required(value = true): this {
        this.data.required = value;
        return this;
    }

    defaultValues(value: NonNullable<T["default_values"]>): this {
        this.data.default_values = [...value] as T["default_values"];
        return this;
    }

    execute(handler: SnowcordInteractionExecutor): this {
        this.executorValue = handler;
        return this;
    }

    build(): T {
        const customId = this.data.custom_id ?? nextCustomId("auto-select");
        if (this.executorValue) {
            registerComponentExecutor(customId, this.executorValue);
        }
        return {
            ...this.data,
            custom_id: customId,
            default_values: this.data.default_values ? [...this.data.default_values] : undefined,
        };
    }

    toJSON(): T {
        return this.build();
    }
}

export class UserSelectMenuBuilder extends BaseAutoSelectMenuBuilder<APIUserSelectComponent> {
    constructor(initial?: Partial<APIUserSelectComponent>) {
        super(ComponentType.UserSelect, initial);
    }
}

export class RoleSelectMenuBuilder extends BaseAutoSelectMenuBuilder<APIRoleSelectComponent> {
    constructor(initial?: Partial<APIRoleSelectComponent>) {
        super(ComponentType.RoleSelect, initial);
    }
}

export class MentionableSelectMenuBuilder extends BaseAutoSelectMenuBuilder<APIMentionableSelectComponent> {
    constructor(initial?: Partial<APIMentionableSelectComponent>) {
        super(ComponentType.MentionableSelect, initial);
    }
}

export class ChannelSelectMenuBuilder extends BaseAutoSelectMenuBuilder<APIChannelSelectComponent> {
    constructor(initial?: Partial<APIChannelSelectComponent>) {
        super(ComponentType.ChannelSelect, initial);
    }

    channelTypes(value: ChannelType[]): this {
        this.data.channel_types = [...value];
        return this;
    }
}

export class ActionRowBuilder {
    private idValue: number | undefined;
    private readonly componentsValue: APIComponentInMessageActionRow[];

    constructor(initial?: Partial<APIActionRowComponent<APIComponentInMessageActionRow>>) {
        this.idValue = initial?.id;
        this.componentsValue = initial?.components ? [...initial.components] : [];
    }

    id(value: number): this {
        this.idValue = value;
        return this;
    }

    raw(component: APIComponentInMessageActionRow): this {
        this.componentsValue.push(component);
        return this;
    }

    button(builder: BuilderCallback<ButtonBuilder>): this;
    button(component: APIButtonComponent): this;
    button(): this;
    button(input?: ButtonInput): this {
        this.componentsValue.push(resolveButton(input));
        return this;
    }

    selectMenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    selectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    stringSelectMenu(input?: StringSelectInput): this {
        this.componentsValue.push(resolveStringSelectMenu(input));
        return this;
    }

    stringselectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    userSelectMenu(input?: UserSelectInput): this {
        this.componentsValue.push(resolveUserSelectMenu(input));
        return this;
    }

    userselectmenu(input?: UserSelectInput): this {
        return this.userSelectMenu(input);
    }

    roleSelectMenu(input?: RoleSelectInput): this {
        this.componentsValue.push(resolveRoleSelectMenu(input));
        return this;
    }

    roleselectmenu(input?: RoleSelectInput): this {
        return this.roleSelectMenu(input);
    }

    mentionableSelectMenu(input?: MentionableSelectInput): this {
        this.componentsValue.push(resolveMentionableSelectMenu(input));
        return this;
    }

    mentionableselectmenu(input?: MentionableSelectInput): this {
        return this.mentionableSelectMenu(input);
    }

    channelSelectMenu(input?: ChannelSelectInput): this {
        this.componentsValue.push(resolveChannelSelectMenu(input));
        return this;
    }

    channelselectmenu(input?: ChannelSelectInput): this {
        return this.channelSelectMenu(input);
    }

    build(): APIActionRowComponent<APIComponentInMessageActionRow> {
        const components = this.componentsValue.length > 0
            ? [...this.componentsValue]
            : [new ButtonBuilder().label("Button").build()];

        return {
            type: ComponentType.ActionRow,
            id: this.idValue,
            components,
        };
    }

    toJSON(): APIActionRowComponent<APIComponentInMessageActionRow> {
        return this.build();
    }
}

export class TextDisplayBuilder {
    private data: APITextDisplayComponent;

    constructor(initial?: Partial<APITextDisplayComponent>) {
        this.data = {
            type: ComponentType.TextDisplay,
            content: " ",
            ...(initial ?? {}),
        };
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    content(value: string): this {
        this.data.content = value;
        return this;
    }

    build(): APITextDisplayComponent {
        return { ...this.data };
    }

    toJSON(): APITextDisplayComponent {
        return this.build();
    }
}

export class ThumbnailBuilder {
    private data: APIThumbnailComponent;

    constructor(initial?: Partial<APIThumbnailComponent>) {
        this.data = {
            type: ComponentType.Thumbnail,
            media: { url: "https://cdn.discordapp.com/embed/avatars/0.png" },
            ...(initial ?? {}),
        };
        if (initial?.media) {
            this.data.media = cloneMediaItem(initial.media);
        }
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    media(value: APIUnfurledMediaItem): this {
        this.data.media = cloneMediaItem(value);
        return this;
    }

    url(value: string): this {
        this.data.media = { ...this.data.media, url: value };
        return this;
    }

    description(value: string | null): this {
        this.data.description = value;
        return this;
    }

    spoiler(value = true): this {
        this.data.spoiler = value;
        return this;
    }

    build(): APIThumbnailComponent {
        return {
            ...this.data,
            media: cloneMediaItem(this.data.media),
        };
    }

    toJSON(): APIThumbnailComponent {
        return this.build();
    }
}

export class AccessoryBuilder {
    private accessoryValue: APISectionAccessoryComponent | undefined;
    private buttonBuilderValue: ButtonBuilder | undefined;

    constructor(initial?: APISectionAccessoryComponent) {
        this.accessoryValue = initial;
    }

    button(builder: BuilderCallback<ButtonBuilder>): this;
    button(component: APIButtonComponent): this;
    button(): ButtonBuilder;
    button(input?: ButtonInput): this | ButtonBuilder {
        if (input === undefined) {
            if (!this.buttonBuilderValue) {
                const initialButton = this.accessoryValue?.type === ComponentType.Button
                    ? this.accessoryValue
                    : undefined;
                this.buttonBuilderValue = new ButtonBuilder(initialButton);
            }
            return this.buttonBuilderValue;
        }

        this.buttonBuilderValue = undefined;
        this.accessoryValue = resolveButton(input);
        return this;
    }

    thumbnail(input?: ThumbnailInput): this {
        this.accessoryValue = resolveThumbnail(input);
        return this;
    }

    tumbnail(input?: ThumbnailInput): this {
        return this.thumbnail(input);
    }

    raw(value: APISectionAccessoryComponent): this {
        this.accessoryValue = value;
        return this;
    }

    build(): APISectionAccessoryComponent {
        if (this.buttonBuilderValue) {
            return this.buttonBuilderValue.build();
        }
        return this.accessoryValue ?? new ButtonBuilder().label("Open").build();
    }

    toJSON(): APISectionAccessoryComponent {
        return this.build();
    }
}

export class SectionSideBuilder extends AccessoryBuilder { }

export class SectionBuilder {
    private idValue: number | undefined;
    private readonly componentsValue: APITextDisplayComponent[];
    private accessoryValue: APISectionAccessoryComponent | undefined;
    private accessoryBuilderValue: AccessoryBuilder | undefined;

    constructor(initial?: Partial<APISectionComponent>) {
        this.idValue = initial?.id;
        this.componentsValue = initial?.components ? initial.components.map((item) => ({ ...item })) : [];
        this.accessoryValue = initial?.accessory;
    }

    id(value: number): this {
        this.idValue = value;
        return this;
    }

    text(input?: TextDisplayInput): this {
        this.componentsValue.push(resolveTextDisplay(input));
        return this;
    }

    texts(input: APITextDisplayComponent[]): this {
        this.componentsValue.push(...input.map((item) => ({ ...item })));
        return this;
    }

    side(): AccessoryBuilder;
    side(input: AccessoryInput): this;
    side(input?: AccessoryInput): this | AccessoryBuilder {
        if (input === undefined) {
            if (!this.accessoryBuilderValue) {
                this.accessoryBuilderValue = new AccessoryBuilder(this.accessoryValue);
            }
            return this.accessoryBuilderValue;
        }
        this.accessoryBuilderValue = undefined;
        this.accessoryValue = resolveSectionAccessory(input);
        return this;
    }

    accessory(): AccessoryBuilder;
    accessory(input: AccessoryInput): this;
    accessory(input?: AccessoryInput): this | AccessoryBuilder {
        if (input === undefined) {
            return this.side();
        }
        return this.side(input);
    }

    build(): APISectionComponent {
        const components = this.componentsValue.length > 0
            ? this.componentsValue.slice(0, 3).map((item) => ({ ...item }))
            : [new TextDisplayBuilder().content(" ").build()];

        return {
            type: ComponentType.Section,
            id: this.idValue,
            components,
            accessory: this.accessoryBuilderValue?.build() ?? this.accessoryValue ?? new AccessoryBuilder().button().build(),
        };
    }

    toJSON(): APISectionComponent {
        return this.build();
    }
}

export class MediaGalleryBuilder {
    private data: APIMediaGalleryComponent;

    constructor(initial?: Partial<APIMediaGalleryComponent>) {
        this.data = {
            type: ComponentType.MediaGallery,
            items: [],
            ...(initial ?? {}),
        };
        if (initial?.items) {
            this.data.items = initial.items.map((item) => ({
                ...item,
                media: cloneMediaItem(item.media),
            }));
        }
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    item(value: APIMediaGalleryItem | string): this {
        if (typeof value === "string") {
            this.data.items.push({ media: { url: value } });
            return this;
        }

        this.data.items.push({
            ...value,
            media: cloneMediaItem(value.media),
        });
        return this;
    }

    items(value: APIMediaGalleryItem[]): this {
        this.data.items = value.map((item) => ({
            ...item,
            media: cloneMediaItem(item.media),
        }));
        return this;
    }

    build(): APIMediaGalleryComponent {
        const items = this.data.items.length > 0
            ? this.data.items.map((item) => ({
                ...item,
                media: cloneMediaItem(item.media),
            }))
            : [{ media: { url: "https://example.com/image.png" } }];

        return {
            ...this.data,
            items,
        };
    }

    toJSON(): APIMediaGalleryComponent {
        return this.build();
    }
}

export class FileBuilder {
    private data: APIFileComponent;

    constructor(initial?: Partial<APIFileComponent>) {
        this.data = {
            type: ComponentType.File,
            file: { url: "attachment://file.bin" },
            ...(initial ?? {}),
        };
        if (initial?.file) {
            this.data.file = cloneMediaItem(initial.file);
        }
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    file(value: APIUnfurledMediaItem): this {
        this.data.file = cloneMediaItem(value);
        return this;
    }

    attachment(filename: string): this {
        this.data.file = { url: `attachment://${filename}` };
        return this;
    }

    spoiler(value = true): this {
        this.data.spoiler = value;
        return this;
    }

    build(): APIFileComponent {
        return {
            ...this.data,
            file: cloneMediaItem(this.data.file),
        };
    }

    toJSON(): APIFileComponent {
        return this.build();
    }
}

export class SeparatorBuilder {
    private data: APISeparatorComponent;

    constructor(initial?: Partial<APISeparatorComponent>) {
        this.data = {
            type: ComponentType.Separator,
            ...(initial ?? {}),
        };
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    divider(value = true): this {
        this.data.divider = value;
        return this;
    }

    spacing(value: SeparatorSpacingSize): this {
        this.data.spacing = value;
        return this;
    }

    build(): APISeparatorComponent {
        return { ...this.data };
    }

    toJSON(): APISeparatorComponent {
        return this.build();
    }
}

export class TextInputBuilder {
    private data: Omit<APITextInputComponent, "type"> & { id?: number };

    constructor(initial?: Partial<APITextInputComponent>) {
        this.data = {
            custom_id: nextCustomId("text-input"),
            label: "Input",
            style: TextInputStyle.Short,
            ...(initial ?? {}),
        };
    }

    id(value: number): this {
        this.data.id = value;
        return this;
    }

    customId(value: string): this {
        this.data.custom_id = value;
        return this;
    }

    ref(value: string): this {
        return this.customId(value);
    }

    label(value: string): this {
        this.data.label = value;
        return this;
    }

    style(value: TextInputStyle): this {
        this.data.style = value;
        return this;
    }

    short(): this {
        return this.style(TextInputStyle.Short);
    }

    paragraph(): this {
        return this.style(TextInputStyle.Paragraph);
    }

    minLength(value: number): this {
        this.data.min_length = value;
        return this;
    }

    maxLength(value: number): this {
        this.data.max_length = value;
        return this;
    }

    required(value = true): this {
        this.data.required = value;
        return this;
    }

    value(text: string): this {
        this.data.value = text;
        return this;
    }

    placeholder(text: string): this {
        this.data.placeholder = text;
        return this;
    }

    build(): APITextInputComponent {
        return {
            type: ComponentType.TextInput,
            ...this.data,
            custom_id: this.data.custom_id ?? nextCustomId("text-input"),
            label: this.data.label ?? "Input",
            style: this.data.style ?? TextInputStyle.Short,
        };
    }

    toJSON(): APITextInputComponent {
        return this.build();
    }
}

export class ModalActionRowBuilder {
    private idValue: number | undefined;
    private textInputValue: APITextInputComponent | undefined;

    constructor(initial?: Partial<APIActionRowComponent<APITextInputComponent>>) {
        this.idValue = initial?.id;
        this.textInputValue = initial?.components?.[0] ? cloneTextInputComponent(initial.components[0]) : undefined;
    }

    id(value: number): this {
        this.idValue = value;
        return this;
    }

    textInput(input?: TextInputInput): this {
        this.textInputValue = resolveTextInput(input);
        return this;
    }

    textinput(input?: TextInputInput): this {
        return this.textInput(input);
    }

    raw(component: APITextInputComponent): this {
        this.textInputValue = cloneTextInputComponent(component);
        return this;
    }

    build(): APIActionRowComponent<APITextInputComponent> {
        return {
            type: ComponentType.ActionRow,
            id: this.idValue,
            components: [this.textInputValue ?? new TextInputBuilder().build()],
        };
    }

    toJSON(): APIActionRowComponent<APITextInputComponent> {
        return this.build();
    }
}

export class ModalBuilder {
    private customIdValue: string;
    private titleValue: string;
    private readonly componentsValue: APIActionRowComponent<APITextInputComponent>[];
    private executorValue: SnowcordInteractionExecutor | undefined;

    constructor(initial?: Partial<APIModalInteractionResponseCallbackData>) {
        this.customIdValue = initial?.custom_id ?? nextCustomId("modal");
        this.titleValue = initial?.title ?? "Modal";
        this.componentsValue = (initial?.components ?? []).flatMap((component) => {
            if (component.type !== ComponentType.ActionRow) {
                return [];
            }

            const textInputs = component.components
                .filter((rowComponent): rowComponent is APITextInputComponent => rowComponent.type === ComponentType.TextInput)
                .map((rowComponent) => cloneTextInputComponent(rowComponent));

            if (textInputs.length === 0) {
                return [];
            }

            return [{
                type: ComponentType.ActionRow,
                id: component.id,
                components: textInputs,
            } satisfies APIActionRowComponent<APITextInputComponent>];
        });
    }

    customId(value: string): this {
        this.customIdValue = value;
        return this;
    }

    ref(value: string): this {
        return this.customId(value);
    }

    title(value: string): this {
        this.titleValue = value;
        return this;
    }

    row(input?: ModalActionRowInput): this {
        this.componentsValue.push(resolveModalActionRow(input));
        return this;
    }

    actionRow(input?: ModalActionRowInput): this {
        return this.row(input);
    }

    textInput(input?: TextInputInput): this {
        return this.row((row) => row.textInput(input));
    }

    textinput(input?: TextInputInput): this {
        return this.textInput(input);
    }

    execute(handler: SnowcordInteractionExecutor): this {
        this.executorValue = handler;
        return this;
    }

    build(): APIModalInteractionResponseCallbackData {
        if (this.executorValue) {
            registerModalExecutor(this.customIdValue, this.executorValue);
        }

        return {
            custom_id: this.customIdValue,
            title: this.titleValue,
            components: this.componentsValue.length > 0
                ? this.componentsValue.map((row) => cloneModalActionRow(row))
                : [new ModalActionRowBuilder().textInput().build()],
        };
    }

    toJSON(): APIModalInteractionResponseCallbackData {
        return this.build();
    }
}

export class ContainerBuilder {
    private readonly componentsValue: APIComponentInContainer[];
    private idValue: number | undefined;
    private accentColorValue: number | null | undefined;
    private spoilerValue: boolean | undefined;

    constructor(initial?: Partial<APIContainerComponent>) {
        this.componentsValue = initial?.components ? [...initial.components] : [];
        this.idValue = initial?.id;
        this.accentColorValue = initial?.accent_color;
        this.spoilerValue = initial?.spoiler;
    }

    id(value: number): this {
        this.idValue = value;
        return this;
    }

    accentColor(value: number | null): this {
        this.accentColorValue = value;
        return this;
    }

    spoiler(value = true): this {
        this.spoilerValue = value;
        return this;
    }

    raw(component: APIComponentInContainer): this {
        this.componentsValue.push(component);
        return this;
    }

    actionRow(input?: ActionRowInput): this {
        this.componentsValue.push(resolveActionRow(input));
        return this;
    }

    button(builder: BuilderCallback<ButtonBuilder>): this;
    button(component: APIButtonComponent): this;
    button(): this;
    button(input?: ButtonInput): this {
        if (input === undefined) {
            return this.actionRow((row) => row.button());
        }
        if (typeof input === "function") {
            return this.actionRow((row) => row.button(input));
        }
        return this.actionRow((row) => row.button(input));
    }

    selectMenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    selectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    stringSelectMenu(input?: StringSelectInput): this {
        return this.actionRow((row) => row.stringSelectMenu(input));
    }

    stringselectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    userSelectMenu(input?: UserSelectInput): this {
        return this.actionRow((row) => row.userSelectMenu(input));
    }

    userselectmenu(input?: UserSelectInput): this {
        return this.userSelectMenu(input);
    }

    roleSelectMenu(input?: RoleSelectInput): this {
        return this.actionRow((row) => row.roleSelectMenu(input));
    }

    roleselectmenu(input?: RoleSelectInput): this {
        return this.roleSelectMenu(input);
    }

    mentionableSelectMenu(input?: MentionableSelectInput): this {
        return this.actionRow((row) => row.mentionableSelectMenu(input));
    }

    mentionableselectmenu(input?: MentionableSelectInput): this {
        return this.mentionableSelectMenu(input);
    }

    channelSelectMenu(input?: ChannelSelectInput): this {
        return this.actionRow((row) => row.channelSelectMenu(input));
    }

    channelselectmenu(input?: ChannelSelectInput): this {
        return this.channelSelectMenu(input);
    }

    text(input?: TextDisplayInput): this {
        this.componentsValue.push(resolveTextDisplay(input));
        return this;
    }

    section(input?: SectionInput): this {
        this.componentsValue.push(resolveSection(input));
        return this;
    }

    mediaGallery(input?: MediaGalleryInput): this {
        this.componentsValue.push(resolveMediaGallery(input));
        return this;
    }

    file(input?: FileInput): this {
        this.componentsValue.push(resolveFile(input));
        return this;
    }

    separator(input?: SeparatorInput): this {
        this.componentsValue.push(resolveSeparator(input));
        return this;
    }

    container(input?: ContainerInput): this {
        const nested = resolveContainer(input);
        this.componentsValue.push(...nested.components);
        return this;
    }

    build(): APIContainerComponent {
        if (this.componentsValue.length > 10) {
            throw new Error("Container supports at most 10 components.");
        }

        const components = this.componentsValue.length > 0
            ? [...this.componentsValue]
            : [new TextDisplayBuilder().content(" ").build()];

        return {
            type: ComponentType.Container,
            id: this.idValue,
            accent_color: this.accentColorValue,
            spoiler: this.spoilerValue,
            components,
        };
    }

    toJSON(): APIContainerComponent {
        return this.build();
    }
}

export class MessageComponentsBuilder {
    private readonly componentsValue: APIMessageTopLevelComponent[];

    constructor(initial?: APIMessageTopLevelComponent[]) {
        this.componentsValue = initial ? [...initial] : [];
    }

    raw(component: APIMessageTopLevelComponent): this {
        this.componentsValue.push(component);
        return this;
    }

    actionRow(input?: ActionRowInput): this {
        this.componentsValue.push(resolveActionRow(input));
        return this;
    }

    button(builder: BuilderCallback<ButtonBuilder>): this;
    button(component: APIButtonComponent): this;
    button(): this;
    button(input?: ButtonInput): this {
        if (input === undefined) {
            return this.actionRow((row) => row.button());
        }
        if (typeof input === "function") {
            return this.actionRow((row) => row.button(input));
        }
        return this.actionRow((row) => row.button(input));
    }

    selectMenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    selectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    stringSelectMenu(input?: StringSelectInput): this {
        return this.actionRow((row) => row.stringSelectMenu(input));
    }

    stringselectmenu(input?: StringSelectInput): this {
        return this.stringSelectMenu(input);
    }

    userSelectMenu(input?: UserSelectInput): this {
        return this.actionRow((row) => row.userSelectMenu(input));
    }

    userselectmenu(input?: UserSelectInput): this {
        return this.userSelectMenu(input);
    }

    roleSelectMenu(input?: RoleSelectInput): this {
        return this.actionRow((row) => row.roleSelectMenu(input));
    }

    roleselectmenu(input?: RoleSelectInput): this {
        return this.roleSelectMenu(input);
    }

    mentionableSelectMenu(input?: MentionableSelectInput): this {
        return this.actionRow((row) => row.mentionableSelectMenu(input));
    }

    mentionableselectmenu(input?: MentionableSelectInput): this {
        return this.mentionableSelectMenu(input);
    }

    channelSelectMenu(input?: ChannelSelectInput): this {
        return this.actionRow((row) => row.channelSelectMenu(input));
    }

    channelselectmenu(input?: ChannelSelectInput): this {
        return this.channelSelectMenu(input);
    }

    text(input?: TextDisplayInput): this {
        this.componentsValue.push(resolveTextDisplay(input));
        return this;
    }

    section(input?: SectionInput): this {
        this.componentsValue.push(resolveSection(input));
        return this;
    }

    container(input?: ContainerInput): this {
        this.componentsValue.push(resolveContainer(input));
        return this;
    }

    mediaGallery(input?: MediaGalleryInput): this {
        this.componentsValue.push(resolveMediaGallery(input));
        return this;
    }

    file(input?: FileInput): this {
        this.componentsValue.push(resolveFile(input));
        return this;
    }

    separator(input?: SeparatorInput): this {
        this.componentsValue.push(resolveSeparator(input));
        return this;
    }

    build(): MessageComponent[] {
        return [...this.componentsValue] as unknown as MessageComponent[];
    }

    toJSON(): MessageComponent[] {
        return this.build();
    }
}

const resolveButton = (input?: ButtonInput): APIButtonComponent => {
    if (!input) return new ButtonBuilder().label("Button").build();
    if (typeof input === "function") {
        const builder = new ButtonBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveStringSelectMenu = (input?: StringSelectInput): APIStringSelectComponent => {
    if (!input) return new StringSelectMenuBuilder().build();
    if (typeof input === "function") {
        const builder = new StringSelectMenuBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveUserSelectMenu = (input?: UserSelectInput): APIUserSelectComponent => {
    if (!input) return new UserSelectMenuBuilder().build();
    if (typeof input === "function") {
        const builder = new UserSelectMenuBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveRoleSelectMenu = (input?: RoleSelectInput): APIRoleSelectComponent => {
    if (!input) return new RoleSelectMenuBuilder().build();
    if (typeof input === "function") {
        const builder = new RoleSelectMenuBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveMentionableSelectMenu = (input?: MentionableSelectInput): APIMentionableSelectComponent => {
    if (!input) return new MentionableSelectMenuBuilder().build();
    if (typeof input === "function") {
        const builder = new MentionableSelectMenuBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveChannelSelectMenu = (input?: ChannelSelectInput): APIChannelSelectComponent => {
    if (!input) return new ChannelSelectMenuBuilder().build();
    if (typeof input === "function") {
        const builder = new ChannelSelectMenuBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveActionRow = (input?: ActionRowInput): APIActionRowComponent<APIComponentInMessageActionRow> => {
    if (!input) return new ActionRowBuilder().build();
    if (typeof input === "function") {
        const builder = new ActionRowBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveTextDisplay = (input?: TextDisplayInput): APITextDisplayComponent => {
    if (!input) return new TextDisplayBuilder().build();
    if (typeof input === "string") return new TextDisplayBuilder().content(input).build();
    if (typeof input === "function") {
        const builder = new TextDisplayBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveThumbnail = (input?: ThumbnailInput): APIThumbnailComponent => {
    if (!input) return new ThumbnailBuilder().build();
    if (typeof input === "function") {
        const builder = new ThumbnailBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveSectionAccessory = (
    input?: AccessoryInput
): APISectionAccessoryComponent => {
    if (!input) return new AccessoryBuilder().button().build();
    if (typeof input === "function") {
        const builder = new AccessoryBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveSection = (input?: SectionInput): APISectionComponent => {
    if (!input) return new SectionBuilder().build();
    if (typeof input === "function") {
        const builder = new SectionBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveContainer = (input?: ContainerInput): APIContainerComponent => {
    if (!input) return new ContainerBuilder().build();
    if (typeof input === "function") {
        const builder = new ContainerBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveMediaGallery = (input?: MediaGalleryInput): APIMediaGalleryComponent => {
    if (!input) return new MediaGalleryBuilder().build();
    if (typeof input === "function") {
        const builder = new MediaGalleryBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveFile = (input?: FileInput): APIFileComponent => {
    if (!input) return new FileBuilder().build();
    if (typeof input === "function") {
        const builder = new FileBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveSeparator = (input?: SeparatorInput): APISeparatorComponent => {
    if (!input) return new SeparatorBuilder().build();
    if (typeof input === "function") {
        const builder = new SeparatorBuilder();
        input(builder);
        return builder.build();
    }
    return input;
};

const resolveTextInput = (input?: TextInputInput): APITextInputComponent => {
    if (!input) return new TextInputBuilder().build();
    if (typeof input === "function") {
        const builder = new TextInputBuilder();
        input(builder);
        return builder.build();
    }
    return cloneTextInputComponent(input);
};

const resolveModalActionRow = (input?: ModalActionRowInput): APIActionRowComponent<APITextInputComponent> => {
    if (!input) return new ModalActionRowBuilder().build();
    if (typeof input === "function") {
        const builder = new ModalActionRowBuilder();
        input(builder);
        return builder.build();
    }
    return cloneModalActionRow(input);
};

export const buildComponents = (
    initial?: APIMessageTopLevelComponent[]
): MessageComponentsBuilder => new MessageComponentsBuilder(initial);

export const buildModal = (
    initial?: Partial<APIModalInteractionResponseCallbackData>
): ModalBuilder => new ModalBuilder(initial);
