import {Input, Message, InputMethod, VoicePlatform, Suggestion, Context, Output} from 'chatbotbase';

// TODO split the logic since this is just partially supporting Dialogflow (in fact just Actions on Google)
export class Dialogflow extends VoicePlatform {
    platformId(): string {
        return 'Dialogflow';
    }

    parse(body: any): Input {
        console.log("INPUT", body);
        const data: Context = {};
        let inputMethod = InputMethod.text;
        body.result.contexts.forEach(context => {
            if(context.parameters && context.parameters.boxed === true) {
                data[context.name] = context.parameters.value
            } else {
                data[context.name] = context.parameters
            }
        });
        let platform, text, userId;
        if(body.originalRequest && body.originalRequest.source === 'google') {
            const capabilities = body.originalRequest.data.surface.capabilities;
            platform = 'Google Home';
            for(let i = 0; i < capabilities.length; i++) {
                if(capabilities[i].name === 'actions.capability.SCREEN_OUTPUT') {
                    platform = 'Google Assistant';
                    break;
                }
            }
            //text = body.originalRequest.data.inputs[0].rawInputs[0].query;
            userId = body.originalRequest.data.user.userId;
            const inputs = body.originalRequest.data.inputs;
            for(let i = 0; i < inputs.length; i++) {
                if(inputs[i].rawInputs) {
                    for(let j = 0; j < inputs[i].rawInputs.length; j++) {
                        if(inputs[i].rawInputs[j].query) {
                            text = inputs[i].rawInputs[j].query;
                            switch(inputs[i].rawInputs[j].inputType) {
                            case 'VOICE':
                                inputMethod = InputMethod.voice;
                                break;
                            case 'KEYBOARD':
                                inputMethod = InputMethod.text;
                                break;
                            case 'TOUCH':
                                inputMethod = InputMethod.touch;
                                break;
                            }
                            break;
                        }
                    }
                }
            }
        } else if(body.result && body.result.source === 'agent') {
            platform = 'Dialogflow';
            text = body.result.resolvedQuery;
            userId = 'unknown';
        }
        return new Input(
            body.id,
            userId,
            body.sessionId,
            body.lang || body.originalRequest.data.user.locale,
            platform,
            new Date(body.timestamp),
            body.result.metadata.intentName,
            inputMethod,
            text,
            data);
    }

    render(reply: Output): any {
        let plainReply, formattedReply, messages = <any>[], suggestions = <any>[], context = <any>[], test = <any>[];
        let hasSimpleMessage = false;
        reply.messages.forEach(msg => {
            if(msg.platform === '*') {
                if(msg.type === 'plain') {
                    plainReply = msg.render();

                } else if(msg.type === 'formatted') {
                    formattedReply = msg.render();
                }
            } else if(msg.platform === 'Dialogflow') {
                if(msg.type === 'simpleMessage') {
                    hasSimpleMessage = true;
                }
                if(msg.type === 'listCard') {
                    test.push(msg.render());
                } else {
                    messages.push(msg.render());
                }
            }
        });
        reply.suggestions.forEach(suggestion => {
            if(suggestion.platform === 'Dialogflow') {
                suggestions.push(suggestion.render());
            } else if(suggestion.platform === '*') {
                suggestions.push(Dialogflow.suggestion(suggestion.render()).render());
            }
        });
        for(let key in reply.context) {
            let value = reply.context[key];
            if((typeof value) !== 'object') {
                value = {value: value, boxed: true};
            }
            context.push({name: key, lifespan: 60, parameters: value});
        }
        formattedReply = formattedReply || plainReply;
        // add the plain response if there is no explicit simple response
        if(!hasSimpleMessage) {
            // insert at front
            const newList = [{
                simpleResponse: {
                    textToSpeech: plainReply,
                    displayText: formattedReply
                }
            }];
            messages.forEach(msg => newList.push(msg));
            messages = newList
        }
        // add the plain response for dialogflow
        test.push([{type: 0, speech: plainReply}]);
        const dialogflowSuggestions = {
            type: 2,
            replies: <any>[]
        };
        reply.suggestions.forEach(suggestion => {
            if(suggestion.platform === '*') {
                dialogflowSuggestions.replies.push(suggestion.render())
            }
        });
        test.push(dialogflowSuggestions);
        return {
            speech: `<speak>${plainReply}</speak>`,
            displayText: formattedReply || plainReply,
            data: {
                google: {
                    expectUserResponse: reply.expectAnswer,
                    noInputPrompts: [],
                    richResponse: {
                        items: messages,
                        suggestions: suggestions
                    }
                }
            },
            messages: test,
            contextOut: context,
            source: "Whatever"
        };
    }

    isSupported(json: any) {
        return json.hasOwnProperty('originalRequest') || (json.result && json.result.source)
    }

    static simpleMessage(message: string): Message {
        return <Message>{
            platform: 'Dialogflow',
            type: 'simpleMessage',
            render: () => {
                return {
                    simpleResponse: {
                        textToSpeech: message,
                        displayText: message
                    }
                }
            },
            debug: () => message
        };
    }

    static basicCard(title: string, message: string, buttons?: DialogflowButton): Message {
        return <Message>{
            platform: 'Dialogflow',
            type: 'basicCard',
            render: () => {
                return {
                    basicCard: {
                        title: title,
                        formattedText: message,
                        buttons: typeof buttons === 'object' ? [buttons] : []
                    }
                }
            },
            debug: () => message
        };
    }

    static imageCard(title: string, message: string, imageUrl: string, contentDescription?: string, buttons?: DialogflowButton): Message {
        return <Message>{
            platform: 'Dialogflow',
            type: 'basicCard',
            render: () => {
                return {
                    basicCard: {
                        title: title,
                        formattedText: message,
                        image: {
                            url: imageUrl,
                            accessibility_text: contentDescription
                        },
                        buttons: buttons ? [] : [buttons],
                        imageDisplayOptions: 'CROPPED'
                        // https://github.com/actions-on-google/actions-on-google-nodejs/commit/72dfe485797804e0be921d31822a7fa71234bce7
                    }
                }
            },
            debug: () => 'Dialog with title "' + title + '" and message "' + message + '"'
        };
    }

    static suggestion(suggestion: string): Suggestion {
        return <Suggestion>{
            platform: 'Dialogflow',
            render: () => {
                return {
                    title: suggestion
                }
            },
            toString: () => suggestion
        };
    }

    static listResponse(cardTitle: string, list: ListItem[]): Message {
        const items = <any>[];
        list.forEach(item => items.push(item.render()));
        return <Message>{
            platform: 'Dialogflow',
            type: 'listCard',
            render: () => {
                return {
                    type: "list_card",
                    platform: "google",
                    title: cardTitle,
                    items: items
                }
            },
            debug: () => 'debug'
        }
    }
}

export class DialogflowButton {
    private output: any;

    constructor(title: string, action: string) {
        this.output = {
            title: title,
            openUrlAction: {
                url: action
            }
        };
    }

    public render() {
        return this.output;
    }
}

export class ListItem {
    key: string;
    title: string;
    description: string;
    imageUrl: string;

    constructor(key: string, title: string, description: string, imageUrl: string) {
        this.key = key;
        this.title = title;
        this.description = description;
        this.imageUrl = imageUrl;
    }

    public render() {
        return {
            optionInfo: {
                key: this.key,
                synonyms: []
            },
            title: this.title,
            description: this.description,
            image: {
                url: this.imageUrl
            }
        };
    }
}