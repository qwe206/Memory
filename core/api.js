import { requestSummaryPreset } from '../personal/summary-preset-request.js';
import { notify as toastr } from '../personal/notify.js';
import { extension_settings, getContext } from "/scripts/extensions.js";
import { characters } from "/script.js";
import { getSlotProfile } from './api/api-resolver.js';
import { world_names } from "/scripts/world-info.js";
import { extensionName } from "../utils/settings.js";
import { extractContentByTag, replaceContentByTag, extractFullTagBlock } from '../utils/tagProcessor.js';
import {
  getCombinedWorldbookContent,
  findLatestSummaryLore,
  DEDICATED_LOREBOOK_NAME,
  getChatIdentifier,
} from "./lore.js";

import {
  isGoogleEndpoint,
  convertToGoogleRequest,
  parseGoogleResponse,
  buildGoogleApiUrl
} from '../core/utils/googleAdapter.js';
 
import {
  intelligentPoll,
  createGooglePollingTask,
  progressTracker
} from '../core/utils/pollingManager.js';

import {
  buildGoogleEmbeddingRequest,
  parseGoogleEmbeddingResponse,
  buildGoogleEmbeddingApiUrl
} from './utils/googleAdapter.js';

import { getRequestHeaders } from '/script.js';


let ChatCompletionService = undefined;
try {
    const module = await import('/scripts/custom-request.js');
    ChatCompletionService = module.ChatCompletionService;
    console.log('[Memory-外交部] 已成功召唤“皇家信使”(ChatCompletionService)。');
} catch (e) {
    console.warn("[Memory-外交部] 未能召唤“皇家信使”，部分高级功能（如Claw代理）将受限。请考虑更新SillyTavern版本。", e);
}
 
// Updates are managed by SillyTavern using this repository's manifest.
export async function fetchMessageBoardContent() { return null; }
export async function checkForUpdates() { return null; }

function normalizeApiResponse(responseData) {
    let data = responseData;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (e) {
            console.error(`[${extensionName}] API响应JSON解析失败:`, e);
            return { error: { message: 'Invalid JSON response' } };
        }
    }
    if (data && typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data)) {
        if (Object.hasOwn(data.data, 'data')) {
            data = data.data;
        }
    }
    if (data && data.choices && data.choices[0]) {
        return { content: data.choices[0].message?.content?.trim() };
    }
    if (data && data.content) {
        return { content: data.content.trim() };
    }
    if (data && data.data) { 
        return { data: data.data };
    }
    if (data && data.error) {
        return { error: data.error };
    }
    return data;
}


export async function fetchModels() {
    if (window.AMILY2_LOCK_MODEL_FETCHING) {
        console.warn("[Memory-使节团] 上次任务尚未完成，本次任务取消。");
        toastr.info("上次任务尚未完成，请稍后再试。", "任务排队中");
        return [];
    }

    window.AMILY2_LOCK_MODEL_FETCHING = true;

    try {
        const apiSettings = await getApiSettings('main');
        const apiProvider = apiSettings.apiProvider || 'openai';
        const apiUrl = apiSettings.apiUrl;
        const apiKey = apiSettings.apiKey;
        const $button = $("#amily2_refresh_models");
        const $selector = $("#amily2_model");

        console.log(`[Memory-使节团] 使用 API 提供商: ${apiProvider}`);

        $button.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> 加载中');
        $selector.empty().append($('<option>', { value: '', text: '正在获取模型列表...' }));

        let result = [];

        switch (apiProvider) {
            case 'openai':
                result = await fetchOpenAICompatibleModels(apiUrl, apiKey);
                break;
            case 'openai_test':
                result = await fetchOpenAITestModels(apiUrl, apiKey);
                break;
            case 'google':
                result = await fetchGoogleDirectModels(apiUrl, apiKey);
                break;
            case 'sillytavern_backend':
                result = await fetchSillyTavernBackendModels(apiUrl, apiKey);
                break;
            case 'sillytavern_preset':
                result = await fetchSillyTavernPresetModels();
                break;
            default:
                throw new Error(`未支持的API提供商: ${apiProvider}`);
        }

        if (result.length > 0) {
            toastr.success(`成功获取 ${result.length} 个模型`, "任务成功");
            return result;
        } else {
            toastr.warning("未找到可用模型", "注意");
            return [];
        }

    } catch (error) {
        console.error("[Memory-使节团] 获取模型列表失败:", error);
        toastr.error(`获取模型列表失败: ${error.message}`, "任务失败");
        return [];
    } finally {
        window.AMILY2_LOCK_MODEL_FETCHING = false;
        const $button = $("#amily2_refresh_models");
        $button.prop("disabled", false).html('<i class="fas fa-sync-alt"></i> 刷新模型');
    }
}


async function fetchOpenAICompatibleModels(apiUrl, apiKey) {
    if (!apiUrl || !apiKey) {
        throw new Error("OpenAI兼容模式需要API URL和API Key");
    }

    const baseUrl = apiUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const modelsUrl = `${baseUrl}/v1/models`;

    console.log(`[Memory-使节团] OpenAI兼容模式: ${modelsUrl}`);

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const models = data.data || data.models || [];
    
    return models
        .map(m => m.id || m.model)
        .filter(Boolean)
        .filter(m => !m.toLowerCase().includes('embed'))
        .sort();
}

async function fetchOpenAITestModels(apiUrl, apiKey) {
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            reverse_proxy: apiUrl,
            proxy_password: apiKey,
            chat_completion_source: 'openai'
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const rawData = await response.json();
    const models = Array.isArray(rawData) ? rawData : (rawData.data || rawData.models || []);

    if (!Array.isArray(models)) {
        const errorMessage = 'API未返回有效的模型列表数组';
        throw new Error(errorMessage);
    }

    const formattedModels = models
        .map(m => {
            const modelName = m.name ? m.name.replace('models/', '') : (m.id || m.model || m);
            return {
                id: m.name || m.id || m.model || m,
                name: modelName
            };
        })
        .filter(m => m.id)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    console.log('[Memory-使节团] 全兼容(测试)模式获取到模型:', formattedModels);
    return formattedModels.map(m => m.name);
}


async function fetchGoogleDirectModels(apiUrl, apiKey) {
    if (!apiKey) {
        throw new Error("Google直连模式需要API Key");
    }

    const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com';
    
    const fetchGoogleModels = async (version) => {
        const url = `${GOOGLE_API_BASE_URL}/${version}/models?key=${apiKey}`;
        console.log(`[Memory-使节团] 正在从 Google API (${version}) 获取模型列表: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`获取 Google API (${version}) 模型列表失败: ${response.status}`);
            return [];
        }
        
        const json = await response.json();
        if (!json.models || !Array.isArray(json.models)) {
            return [];
        }
        
        return json.models
            .filter(model => 
                model.supportedGenerationMethods?.includes('generateContent') ||
                model.supportedGenerationMethods?.includes('streamGenerateContent')
            )
            .map(model => model.name.replace('models/', ''));
    };

    const [v1Models, v1betaModels] = await Promise.all([
        fetchGoogleModels('v1'),
        fetchGoogleModels('v1beta')
    ]);

    const allModels = [...new Set([...v1Models, ...v1betaModels])].sort();
    return allModels;
}

async function fetchSillyTavernBackendModels(apiUrl, apiKey) {
    if (!apiUrl) {
        throw new Error("SillyTavern后端模式需要API URL");
    }

    console.log('[Memory-使节团] 通过SillyTavern后端获取模型列表');

    const rawResponse = await $.ajax({
        url: '/api/backends/chat-completions/status',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: apiUrl,
            api_key: apiKey
        })
    });

    const result = normalizeApiResponse(rawResponse);
    const models = result.data || [];

    if (result.error || !Array.isArray(models)) {
        const errorMessage = result.error?.message || 'API未返回有效的模型列表数组';
        throw new Error(errorMessage);
    }

    return models
        .map(model => model.id || model.model)
        .filter(Boolean)
        .sort();
}


async function fetchSillyTavernPresetModels() {
    console.log('[Memory-使节团] 使用SillyTavern预设模式');

    try {
        const context = getContext();
        if (!context) {
            throw new Error("无法获取SillyTavern上下文");
        }

        const currentModel = context.chat_completion_source;
        const models = [];

        if (currentModel) {
            models.push(currentModel);
        }

        const defaultModels = [
            'gpt-3.5-turbo',
            'gpt-4',
            'claude-3-sonnet',
            'claude-3-haiku',
            'gemini-pro'
        ];

        const allModels = [...new Set([...models, ...defaultModels])].sort();
        return allModels;

    } catch (error) {
        console.warn('[Memory-使节团] 获取SillyTavern预设失败，返回默认模型列表:', error);
        

        return [
            'gpt-3.5-turbo',
            'gpt-4',
            'claude-3-sonnet',
            'claude-3-haiku',
            'gemini-pro'
        ];
    }
}
 

export async function getApiSettings(slot = 'main') {
    const s = extension_settings[extensionName] || {};

    // 优先读取槽位分配的 Profile（仅接管连接参数）
    const profile = await getSlotProfile(slot);
    if (profile) {
        return {
            apiProvider:  profile.provider,
            apiUrl:       profile.apiUrl,
            apiKey:       profile.apiKey ?? '',
            model:        profile.model,
            // 温度 / MaxTokens 读面板值（profile-sync 保留了这些输入框）
            maxTokens:    s.maxTokens    ?? profile.maxTokens   ?? 65500,
            temperature:  s.temperature  ?? profile.temperature ?? 1.0,
            tavernProfile: '',
        };
    }

    // 降级：读旧 DOM 面板配置
    const settings = extension_settings[extensionName] || {};
    const apiProvider = document.getElementById('amily2_api_provider')?.value || 'openai';

    let model;
    if (apiProvider === 'sillytavern_preset') {
        const context = getContext();
        const profileId = document.getElementById('amily2_preset_selector')?.value;
        const stProfile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === profileId);
        model = stProfile?.openai_model || 'Preset Model';
    } else {
        model = document.getElementById('amily2_model')?.value;
    }

    return {
        apiProvider,
        apiUrl:       document.getElementById('amily2_api_url')?.value.trim() || '',
        apiKey:       document.getElementById('amily2_api_key')?.value.trim() || '',
        model,
        maxTokens:    settings.maxTokens    || 4000,
        temperature:  settings.temperature  || 0.7,
        tavernProfile: document.getElementById('amily2_preset_selector')?.value || '',
    };
}


export async function testApiConnection() {
    console.log('[Memory-外交部] 开始API连接测试');
    const $button = $("#amily2_test_api_connection");
    if (!$button.length) return;

    const originalHtml = $button.html();
    $button.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> 测试中');

    try {
        const apiSettings = await getApiSettings();

        if (apiSettings.apiProvider === 'sillytavern_preset') {
            if (!apiSettings.tavernProfile) {
                throw new Error("请先在下方选择一个SillyTavern预设");
            }
        } else {
            if (!apiSettings.apiUrl || !apiSettings.apiKey || !apiSettings.model) {
                throw new Error("API配置不完整，请检查URL、Key和模型选择");
            }
        }

        toastr.info('正在发送测试消息"你好！"...', 'API连接测试');
        
        const userName = getContext()?.name1 || '用户';
        const systemPrompt = '这是模型连接测试。请简短回复：连接正常。';

        const testMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '你好！' }
        ];
        
        const response = await callAI(testMessages, {
            maxTokens: 8192,
            temperature: 0.5
        });
        
        if (response && response.trim()) {
            console.log('[Memory-外交部] 测试消息响应:', response);
            toastr.success(`连接测试成功！AI回复: "${response}"`, 'API连接测试成功');
            return true;
        } else {
            throw new Error('API未返回有效响应，请检查您的代理、API URL和密钥是否正确。这通常发生在网络问题或认证失败时。');
        }
        
    } catch (error) {
        console.error('[Memory-使节团] API连接测试失败:', error);
        toastr.error(`连接测试失败: ${error.message}`, 'API连接测试失败');
        return false;
    } finally {
        $button.prop("disabled", false).html(originalHtml);
    }
}

export async function callAI(messages, options = {}) {
    if (window.AMILY2_SYSTEM_PARALYZED === true) {
        console.error("[Memory-制裁] 系统完整性已受损，所有外交活动被无限期中止。");
        return null;
    }

    const apiSettings = await getApiSettings(options.slot || 'main');

    const finalOptions = {
        maxTokens: apiSettings.maxTokens,
        temperature: apiSettings.temperature,
        model: apiSettings.model,
        apiUrl: apiSettings.apiUrl,
        apiKey: apiSettings.apiKey,
        apiProvider: apiSettings.apiProvider,
        ...options
    };

    if (finalOptions.apiProvider !== 'sillytavern_preset') {
        if (!finalOptions.apiUrl || !finalOptions.model) {
            console.warn("[Memory-外交部] API URL或模型未配置，无法调用AI");
            toastr.error("API URL或模型未配置，无法调用AI。", "Amily2-外交部");
            return null;
        }
    }

    console.groupCollapsed(`[Memory-统一API调用] ${new Date().toLocaleTimeString()}`);
    console.log("【请求参数】:", { 
        provider: finalOptions.apiProvider,
        model: finalOptions.model, 
        maxTokens: finalOptions.maxTokens, 
        temperature: finalOptions.temperature,
        messagesCount: messages.length
    });
    console.log("【消息内容】:", messages);
    console.groupEnd();

    try {
        let responseContent;

        switch (finalOptions.apiProvider) {
            case 'openai':
                responseContent = await callOpenAICompatible(messages, finalOptions);
                break;
            case 'openai_test':
                responseContent = await callOpenAITest(messages, finalOptions);
                break;
            case 'google':
                responseContent = await callGoogleDirect(messages, finalOptions);
                break;
            case 'sillytavern_backend':
                responseContent = await callSillyTavernBackend(messages, finalOptions);
                break;
            case 'sillytavern_preset':
                responseContent = await callSillyTavernPreset(messages, finalOptions);
                break;
            default:
                console.error(`[Memory-外交部] 未支持的API提供商: ${finalOptions.apiProvider}`);
                return null;
        }

        if (!responseContent) {
            console.warn('[Memory-外交部] 未能获取AI响应内容，但不视为错误');
            return null;
        }

        console.groupCollapsed("[Memory-AI回复]");
        console.log(responseContent);
        console.groupEnd();

        return responseContent;

    } catch (error) {
        console.error(`[Memory-外交部] API调用发生错误:`, error);

        if (error.message.includes('400')) {
            toastr.error(`API请求格式错误 (400): 请检查消息格式和模型配置`, "API调用失败");
        } else if (error.message.includes('401')) {
            toastr.error(`API认证失败 (401): 请检查API Key配置`, "API调用失败");
        } else if (error.message.includes('403')) {
            toastr.error(`API访问被拒绝 (403): 请检查权限设置`, "API调用失败");
        } else if (error.message.includes('429')) {
            toastr.error(`API调用频率超限 (429): 请稍后重试`, "API调用失败");
        } else if (error.message.includes('500')) {
            toastr.error(`API服务器错误 (500): 请稍后重试`, "API调用失败");
        } else {
            toastr.error(`API调用失败: ${error.message}`, "API调用失败");
        }
        
        return null;
    }
}


async function callOpenAICompatible(messages, options) {
    const baseUrl = options.apiUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const apiUrl = `${baseUrl}/v1/chat/completions`;

    console.log(`[Memory-OpenAI兼容] API地址: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options.model,
            messages: messages,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            stream: false
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI兼容API请求失败: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    return responseData?.choices?.[0]?.message?.content;
}

async function callOpenAITest(messages, options) {
    const body = {
        chat_completion_source: 'openai',
        messages: messages,
        model: options.model,
        reverse_proxy: options.apiUrl,
        proxy_password: options.apiKey,
        stream: false,
        max_tokens: options.maxTokens || 30000,
        temperature: options.temperature || 1,
        top_p: options.top_p || 1,
        custom_prompt_post_processing: 'strict',
        enable_web_search: false,
        frequency_penalty: 0,
        group_names: [],
        include_reasoning: false,
        presence_penalty: 0.12,
        reasoning_effort: 'medium',
        request_images: false,
    };

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI兼容(测试)API请求失败: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    
    if (!responseData || !responseData.choices || responseData.choices.length === 0) {
        console.error('[Memory-OpenAI兼容(测试)] API返回了空的choices数组或错误:', responseData);
        if (responseData.error) {
            throw new Error(`API返回错误: ${responseData.error.message || JSON.stringify(responseData.error)}`);
        }
        return null; 
    }
    
    return responseData?.choices?.[0]?.message?.content;
}


async function callGoogleDirect(messages, options) {
    const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com';

    const apiVersion = options.model.includes('gemini-1.5') ? 'v1beta' : 'v1';
    const finalApiUrl = `${GOOGLE_API_BASE_URL}/${apiVersion}/models/${options.model}:generateContent?key=${options.apiKey}`;
    
    console.log(`[Memory-Google直连] API地址: ${finalApiUrl}`);

    const headers = { 
        "Content-Type": "application/json"
    };

    const requestBody = JSON.stringify(convertToGoogleRequest({ 
        model: options.model, 
        messages, 
        max_tokens: options.maxTokens, 
        temperature: options.temperature 
    }));

    const response = await fetch(finalApiUrl, { 
        method: "POST", 
        headers: headers, 
        body: requestBody 
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API请求失败: ${response.status} - ${errorText}`);
    }

    let responseData = await response.json();

    if (responseData.name && responseData.metadata) {
        console.log("[Memory-Google] 收到异步操作ID，启用轮询机制...");
        const operationId = responseData.name;
        const tracker = progressTracker(operationId, 6);
        tracker.start();
        
        try {
            const pollingTask = createGooglePollingTask(operationId, GOOGLE_API_BASE_URL, { "Content-Type": "application/json" });
            const pollingOptions = { 
                maxAttempts: 6, 
                baseDelay: 3000, 
                shouldStop: res => res.done, 
                onAttempt: (attempt, delay) => { tracker.onAttempt(attempt, delay); }, 
                onError: (error, attempt) => { tracker.error(error.message); }
            };
            const pollingResult = await intelligentPoll(pollingTask, pollingOptions);
            tracker.complete();
            
            if (!pollingResult.response) { 
                throw new Error("轮询完成但未获得有效响应"); 
            }
            responseData = pollingResult.response;
        } catch (pollingError) {
            console.error('[Google轮询错误]', pollingError);
            tracker.error(`轮询失败: ${pollingError.message}`);
            throw new Error("Google轮询任务失败: " + pollingError.message);
        }
    }

    return parseGoogleResponse(responseData)?.choices?.[0]?.message?.content;
}

async function callSillyTavernBackend(messages, options) {
    console.log('[Memory-ST后端] 通过SillyTavern后端调用API');

    const rawResponse = await $.ajax({
        url: '/api/backends/chat-completions/generate',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: options.apiUrl,
            api_key: options.apiKey,
            model: options.model,
            messages: messages,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            stream: false
        })
    });

    const result = normalizeApiResponse(rawResponse);
    if (result.error) {
        throw new Error(result.error.message || 'SillyTavern后端API调用失败');
    }

    return result.content;
}


async function callSillyTavernPreset(messages, options) {
    console.log('[Memory-ST预设] 使用SillyTavern预设调用');

    const context = getContext();
    if (!context) {
        throw new Error('无法获取SillyTavern上下文');
    }

    const profileId = options.tavernProfile || extension_settings[extensionName]?.tavernProfile;
    if (!profileId) {
        throw new Error('未配置SillyTavern预设ID');
    }

    const result = await requestSummaryPreset(context, profileId, messages, options);

    if (!result) {
        throw new Error('未收到API响应');
    }

    const normalizedResult = normalizeApiResponse(result);
    if (normalizedResult.error) {
        throw new Error(normalizedResult.error.message || 'SillyTavern预设API调用失败');
    }

    return normalizedResult.content;
}

export function generateRandomSeed() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const randomLetter = () => letters[Math.floor(Math.random() * letters.length)];
    const randomRoll = (max) => Math.floor(Math.random() * max) + 1;

    let seed = '';
    seed += randomLetter();
    seed += randomRoll(1919819);
    seed += randomLetter();
    seed += randomLetter();
    seed += randomRoll(114514);
    seed += randomLetter();
    seed += randomLetter();
    seed += randomRoll(9999);
    seed += randomRoll(9999);
    seed += randomLetter();
    
    return seed;
}


export async function checkAndFixWithAPI(latestMessage, previousMessages) {
    const { processOptimization } = await import('./summarizer.js');
    return await processOptimization(latestMessage, previousMessages);
}
