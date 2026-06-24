// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isToolCallResponsePart, isUsageResponsePart, LanguageModelMessage, LanguageModelStreamResponsePart, UserRequest } from '@theia/ai-core';
import { OpenAiModelUtils } from './openai-language-model';
import { OpenAiResponseApiUtils } from './openai-response-api-utils';

async function* toStream(events: unknown[]): AsyncIterable<unknown> {
    for (const event of events) {
        yield event;
    }
}

describe('OpenAiResponseApiUtils', () => {
    it('normalizes long historical tool call ids for Response API input', () => {
        const utils = new OpenAiResponseApiUtils();
        const longCallId = `call_${'x'.repeat(416)}`;
        const messages: LanguageModelMessage[] = [
            { actor: 'ai', type: 'tool_use', id: longCallId, name: 'lookup', input: { query: 'test' } },
            { actor: 'user', type: 'tool_result', tool_use_id: longCallId, name: 'lookup', content: 'result' }
        ];

        const result = utils.processMessages(messages, 'developer', 'gpt-5');
        const functionCall = result.input[0];
        const functionCallOutput = result.input[1];

        expect(functionCall).to.include({ type: 'function_call', name: 'lookup' });
        expect(functionCallOutput).to.include({ type: 'function_call_output', output: 'result' });
        if ('call_id' in functionCall && 'call_id' in functionCallOutput) {
            expect(functionCall.call_id).to.equal(functionCallOutput.call_id);
            expect(functionCall.call_id).to.have.length.lessThanOrEqual(64);
            expect(functionCall.call_id).to.match(/^call_[0-9a-f]+$/);
        } else {
            throw new Error('Expected function call input items with call_id');
        }
    });

    it('emits per-iteration usage for Response API tool calls instead of accumulated usage', async () => {
        const utils = new OpenAiResponseApiUtils();
        const longItemId = `item_${'x'.repeat(416)}`;
        const inputs: unknown[] = [];
        const streams = [
            [
                {
                    type: 'response.output_item.added',
                    item: {
                        id: longItemId,
                        call_id: 'call-1',
                        type: 'function_call',
                        name: '',
                        arguments: ''
                    }
                },
                {
                    type: 'response.function_call_arguments.done',
                    item_id: longItemId,
                    name: '',
                    arguments: '{"query":"test"}'
                },
                {
                    type: 'response.output_item.done',
                    item: {
                        call_id: 'call-1',
                        type: 'function_call',
                        name: 'lookup',
                        arguments: '{"query":"test"}'
                    }
                },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 100,
                            output_tokens: 10
                        }
                    }
                }
            ],
            [
                {
                    type: 'response.output_text.delta',
                    delta: 'done'
                },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 200,
                            output_tokens: 20
                        }
                    }
                }
            ]
        ];
        const openai = {
            responses: {
                stream: (params: { input: unknown }) => {
                    inputs.push(params.input);
                    return toStream(streams.shift() ?? []);
                }
            }
        };
        const request: UserRequest = {
            sessionId: 'session-1',
            requestId: 'request-1',
            messages: [{ actor: 'user', type: 'text', text: 'hello' }],
            tools: [{
                id: 'lookup',
                name: 'lookup',
                parameters: { type: 'object', properties: { query: { type: 'string' } } },
                handler: async () => 'result'
            }]
        };

        const response = await utils.handleRequest(
            openai as never,
            request,
            {},
            'gpt-5',
            new OpenAiModelUtils(),
            'developer',
            { maxChatCompletions: 3 },
            'openai/gpt-5',
            true
        );
        const parts: LanguageModelStreamResponsePart[] = [];
        if ('stream' in response) {
            for await (const part of response.stream) {
                parts.push(part);
            }
        }

        expect(parts.filter(isUsageResponsePart)).to.deep.equal([
            { input_tokens: 100, output_tokens: 10 },
            { input_tokens: 200, output_tokens: 20 }
        ]);
        expect(parts.filter(isToolCallResponsePart).flatMap(part => part.tool_calls).map(toolCall => toolCall.id)).to.deep.equal([
            'call-1',
            'call-1'
        ]);
        expect(inputs[1]).to.deep.include({
            type: 'function_call',
            call_id: 'call-1',
            name: 'lookup',
            arguments: '{"query":"test"}'
        });
    });

    it('falls back to the only available tool name when Copilot omits it from stream events', async () => {
        const utils = new OpenAiResponseApiUtils();
        const longItemId = `item_${'x'.repeat(416)}`;
        const inputs: unknown[] = [];
        const streams = [
            [
                {
                    type: 'response.output_item.added',
                    output_index: 0,
                    item: {
                        id: longItemId,
                        call_id: 'call-1',
                        type: 'function_call',
                        name: '',
                        arguments: ''
                    }
                },
                {
                    type: 'response.function_call_arguments.done',
                    output_index: 0,
                    item_id: longItemId,
                    name: '',
                    arguments: '{"query":"test"}'
                },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 100,
                            output_tokens: 10
                        }
                    }
                }
            ],
            [
                {
                    type: 'response.output_text.delta',
                    delta: 'done'
                },
                {
                    type: 'response.completed',
                    response: {
                        usage: {
                            input_tokens: 200,
                            output_tokens: 20
                        }
                    }
                }
            ]
        ];
        const openai = {
            responses: {
                stream: (params: { input: unknown }) => {
                    inputs.push(params.input);
                    return toStream(streams.shift() ?? []);
                }
            }
        };
        const request: UserRequest = {
            sessionId: 'session-1',
            requestId: 'request-1',
            messages: [{ actor: 'user', type: 'text', text: 'hello' }],
            tools: [{
                id: 'lookup',
                name: 'lookup',
                parameters: { type: 'object', properties: { query: { type: 'string' } } },
                handler: async () => 'result'
            }]
        };

        const response = await utils.handleRequest(
            openai as never,
            request,
            {},
            'gpt-5',
            new OpenAiModelUtils(),
            'developer',
            { maxChatCompletions: 3 },
            'openai/gpt-5',
            true
        );
        if ('stream' in response) {
            for await (const _ of response.stream) {
                // Drain the stream.
            }
        }

        expect(inputs[1]).to.deep.include({
            type: 'function_call',
            call_id: 'call-1',
            name: 'lookup',
            arguments: '{"query":"test"}'
        });
    });
});
