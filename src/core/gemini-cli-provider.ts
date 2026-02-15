import { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';

const GEMINI_CLI_HEADERS = {
    "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": JSON.stringify({
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
    }),
};

export class GeminiCliProvider implements LanguageModelV1 {
    readonly specificationVersion = 'v1';
    readonly defaultObjectGenerationMode = undefined;

    constructor(
        readonly modelId: string,
        private accessToken: string,
        private projectId: string | undefined,
        private isAntigravity: boolean = false
    ) {}

    get provider(): string {
        return this.isAntigravity ? 'antigravity' : 'gemini-cli';
    }

    private async discoverProject(): Promise<string> {
        if (this.projectId) return this.projectId;
        
        const url = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                ...GEMINI_CLI_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: JSON.stringify({
                metadata: {
                    ideType: "IDE_UNSPECIFIED",
                    platform: "PLATFORM_UNSPECIFIED",
                    pluginType: "GEMINI",
                }
            })
        });

        if (!resp.ok) {
            throw new Error(`Project discovery failed: ${resp.status}`);
        }

        const data: any = await resp.json();
        const id = data.cloudaicompanionProject?.id || data.cloudaicompanionProject;
        if (!id) throw new Error("Could not discover Google Cloud project ID");
        this.projectId = id;
        return id;
    }

    async doGenerate(options: any): Promise<any> {
        const projectId = await this.discoverProject();
        const baseUrl = this.isAntigravity 
            ? 'https://daily-cloudcode-pa.sandbox.googleapis.com' 
            : 'https://cloudcode-pa.googleapis.com';
        
        const url = `${baseUrl}/v1internal:generateContent`;

        const requestBody = {
            project: projectId,
            model: this.modelId,
            request: {
                contents: options.prompt.map((m: any) => ({
                    role: m.role === 'assistant' ? 'model' : m.role,
                    parts: m.content.map((c: any) => {
                        if (c.type === 'text') return { text: c.text };
                        if (c.type === 'tool-call') return {
                            functionCall: {
                                name: c.toolName,
                                args: c.args,
                                id: c.toolCallId
                            }
                        };
                        if (c.type === 'tool-result') return {
                            functionResponse: {
                                name: c.toolName,
                                response: { output: c.result },
                                id: c.toolCallId
                            }
                        };
                        return {};
                    })
                })),
                tools: options.tools?.length ? [{
                    functionDeclarations: options.tools.map((t: any) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.parameters
                    }))
                }] : undefined,
                toolConfig: options.toolChoice ? {
                    functionCallingConfig: {
                        mode: options.toolChoice.type === 'auto' ? 'AUTO' : 
                              options.toolChoice.type === 'none' ? 'NONE' : 'ANY'
                    }
                } : undefined,
                generationConfig: {
                    temperature: options.temperature,
                    maxOutputTokens: options.maxTokens,
                    thinkingConfig: {
                        includeThoughts: true,
                        thinkingLevel: "LOW"
                    }
                }
            },
            userAgent: "pi-coding-agent",
            requestId: `ai-gateway-${Date.now()}`
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...GEMINI_CLI_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini CLI API error (${response.status}): ${errorText}`);
        }

        const data: any = await response.json();
        const candidate = data.response?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        
        let text = '';
        const toolCalls: any[] = [];
        
        for (const part of parts) {
            if (part.text) text += part.text;
            if (part.functionCall) {
                toolCalls.push({
                    toolCallType: 'function',
                    toolCallId: part.functionCall.id || `call_${Date.now()}`,
                    toolName: part.functionCall.name,
                    args: JSON.stringify(part.functionCall.args)
                });
            }
        }

        return {
            text,
            toolCalls,
            finishReason: candidate?.finishReason === 'STOP' ? 'stop' : 'other',
            usage: {
                promptTokens: data.response?.usageMetadata?.promptTokenCount || 0,
                completionTokens: (data.response?.usageMetadata?.candidatesTokenCount || 0) + (data.response?.usageMetadata?.thoughtsTokenCount || 0)
            },
            rawCall: { url, body: requestBody },
            rawResponse: { headers: response.headers }
        };
    }

    async doStream(options: any): Promise<{ stream: ReadableStream<LanguageModelV1StreamPart>; rawCall: any; rawResponse: any }> {
        const projectId = await this.discoverProject();
        const baseUrl = this.isAntigravity 
            ? 'https://daily-cloudcode-pa.sandbox.googleapis.com' 
            : 'https://cloudcode-pa.googleapis.com';
        
        const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;

        const requestBody = {
            project: projectId,
            model: this.modelId,
            request: {
                contents: options.prompt.map((m: any) => ({
                    role: m.role === 'assistant' ? 'model' : m.role,
                    parts: m.content.map((c: any) => {
                        if (c.type === 'text') return { text: c.text };
                        if (c.type === 'tool-call') return {
                            functionCall: {
                                name: c.toolName,
                                args: c.args,
                                id: c.toolCallId
                            }
                        };
                        if (c.type === 'tool-result') return {
                            functionResponse: {
                                name: c.toolName,
                                response: { output: c.result },
                                id: c.toolCallId
                            }
                        };
                        return {};
                    })
                })),
                tools: options.tools?.length ? [{
                    functionDeclarations: options.tools.map((t: any) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.parameters
                    }))
                }] : undefined,
                toolConfig: options.toolChoice ? {
                    functionCallingConfig: {
                        mode: options.toolChoice.type === 'auto' ? 'AUTO' : 
                              options.toolChoice.type === 'none' ? 'NONE' : 'ANY'
                    }
                } : undefined,
                generationConfig: {
                    temperature: options.temperature,
                    maxOutputTokens: options.maxTokens,
                    thinkingConfig: {
                        includeThoughts: true,
                        thinkingLevel: "LOW"
                    }
                }
            },
            userAgent: "pi-coding-agent",
            requestId: `ai-gateway-${Date.now()}`
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...GEMINI_CLI_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini CLI API error (${response.status}): ${errorText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        const stream = new ReadableStream<LanguageModelV1StreamPart>({
            async pull(controller) {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                    return;
                }

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.slice(5));
                            const candidates = data.response?.candidates || [];
                            for (const candidate of candidates) {
                                const parts = candidate.content?.parts || [];
                                for (const part of parts) {
                                    if (part.text) {
                                        controller.enqueue({
                                            type: 'text-delta',
                                            textDelta: part.text
                                        });
                                    }
                                    if (part.functionCall) {
                                        controller.enqueue({
                                            type: 'tool-call',
                                            toolCallType: 'function',
                                            toolCallId: part.functionCall.id || `call_${Date.now()}`,
                                            toolName: part.functionCall.name,
                                            args: JSON.stringify(part.functionCall.args)
                                        });
                                    }
                                }
                                if (candidate.finishReason === 'STOP') {
                                    controller.enqueue({
                                        type: 'finish',
                                        finishReason: 'stop',
                                        usage: {
                                            promptTokens: data.response.usageMetadata?.promptTokenCount || 0,
                                            completionTokens: (data.response.usageMetadata?.candidatesTokenCount || 0) + (data.response.usageMetadata?.thoughtsTokenCount || 0)
                                        }
                                    });
                                }
                            }
                        } catch (e) {
                            // Skip parse errors for non-JSON lines
                        }
                    }
                }
            }
        });

        return {
            stream,
            rawCall: { url, body: requestBody },
            rawResponse: { headers: response.headers }
        };
    }
}
