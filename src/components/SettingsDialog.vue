<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Settings } from '../types'
import { DEFAULT_SYSTEM_PROMPT } from '../lib/prompt'
import { defaultSettings, REASONING_OPTIONS } from '../lib/settings'
import { listModels } from '../lib/deepseek'
import { cacheCount, clearCache } from '../lib/cache'

const props = defineProps<{ open: boolean; settings: Settings; configFile?: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', value: Settings): void
}>()

const draft = reactive<Settings>({ ...props.settings })
const showKey = ref(false)
const caches = ref(0)

/** 当前选中的思考强度说明 */
const reasoningHint = computed(
  () => REASONING_OPTIONS.find((o) => o.value === draft.reasoning)?.hint ?? ''
)

type TestState = 'idle' | 'testing' | 'ok' | 'fail'
const testState = ref<TestState>('idle')
const testMessage = ref('')
const models = ref<string[]>([])
/** 模型列表的拉取状态：模型名会变，所以以接口返回为准，不写死在代码里 */
const modelState = ref<'idle' | 'loading' | 'ok' | 'failed'>('idle')
const modelError = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    Object.assign(draft, props.settings)
    testState.value = 'idle'
    testMessage.value = ''
    caches.value = cacheCount()
    // 有 Key 就顺手把真实可用的模型拉出来，省得用户手敲一个已经下线的名字
    void loadModels()
  }
)

async function loadModels() {
  if (!draft.apiKey.trim()) {
    models.value = []
    modelState.value = 'idle'
    return
  }
  modelState.value = 'loading'
  modelError.value = ''
  try {
    models.value = await listModels(draft.baseUrl, draft.apiKey, AbortSignal.timeout(15000))
    modelState.value = 'ok'
  } catch (err) {
    models.value = []
    modelState.value = 'failed'
    modelError.value = (err as Error).message
  }
}

async function testConnection() {
  testState.value = 'testing'
  testMessage.value = ''
  await loadModels()
  if (modelState.value === 'ok') {
    testState.value = 'ok'
    testMessage.value = models.value.length
      ? `连接成功，这个账号可用模型 ${models.value.length} 个`
      : '连接成功（该服务没有返回模型列表，不影响使用）'
  } else {
    testState.value = 'fail'
    testMessage.value = modelError.value
  }
}

function restorePrompt() {
  draft.systemPrompt = DEFAULT_SYSTEM_PROMPT
}

function resetAll() {
  Object.assign(draft, { ...defaultSettings, apiKey: draft.apiKey })
}

function doClearCache() {
  const n = clearCache()
  caches.value = 0
  testState.value = 'ok'
  testMessage.value = `已清空 ${n} 条翻译缓存`
}

function save() {
  emit('save', { ...draft })
}
</script>

<template>
  <div v-if="open" class="modal" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="dialog__head">
        <h2 id="settings-title">阅读与翻译设置</h2>
        <button class="btn btn--icon" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="dialog__body">
        <section class="field">
          <label class="field__label" for="s-base">接口地址</label>
          <input id="s-base" v-model.trim="draft.baseUrl" class="input" spellcheck="false" />
          <p class="field__hint">
            填 OpenAI 兼容接口的 base 即可。DeepSeek 用
            <code>https://api.deepseek.com/v1</code>；只填到域名也行，会自动补全。
          </p>
        </section>

        <section class="field">
          <label class="field__label" for="s-key">API Key</label>
          <div class="row">
            <input
              id="s-key"
              v-model.trim="draft.apiKey"
              class="input"
              :type="showKey ? 'text' : 'password'"
              spellcheck="false"
              autocomplete="off"
              placeholder="sk-..."
            />
            <button class="btn" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
          </div>
          <p class="field__hint">
            在 <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer">DeepSeek 开放平台</a>
            创建自己的 API Key，粘贴后点击「测试连接」，选择可用模型并保存。翻译需要联网，费用由服务商收取。
          </p>
          <p class="field__hint">
            配置保存在本机（便携版为 <code>data/settings.env</code>，源码版为 <code>.env</code>），重启后仍可使用。请勿分享含 Key 的配置文件。
          </p>
        </section>

        <section class="field">
          <label class="field__label" for="s-model">模型</label>
          <input id="s-model" v-model.trim="draft.model" class="input" spellcheck="false" />
          <p class="field__hint">
            模型名由厂商决定、随时可能变（<code>deepseek-chat</code> / <code>deepseek-reasoner</code>
            已于 2026-07-24 下线，现在官方是 <code>deepseek-flash</code> 与
            <code>deepseek-v4-pro</code>）。所以这里不写死，直接问接口要：
            <template v-if="modelState === 'loading'">正在拉取你账号可用的模型…</template>
            <template v-else-if="modelState === 'failed'">
              没拉到列表（{{ modelError }}）。点下面的「测试连接」重试。
            </template>
            <template v-else-if="modelState === 'ok' && models.length">
              以下是这个账号当前可用的模型，点一下即可选用。
            </template>
            <template v-else-if="modelState === 'ok'">该服务没有返回模型列表，请手工填写。</template>
            <template v-else>填了 API Key 后会自动拉取。</template>
          </p>
          <ul v-if="models.length" class="model-list">
            <li
              v-for="m in models"
              :key="m"
              :class="{ 'model-list__on': m === draft.model }"
              @click="draft.model = m"
            >
              {{ m }}
            </li>
          </ul>
        </section>

        <section class="field">
          <label class="field__label" for="s-temp">
            温度 <span class="tag">{{ draft.temperature.toFixed(1) }}</span>
          </label>
          <input
            id="s-temp"
            v-model.number="draft.temperature"
            type="range"
            min="0"
            max="2"
            step="0.1"
            class="range"
          />
          <p class="field__hint">
            默认 0.3。学术翻译要的是稳定与忠实，温度调高容易"顺手改写"公式。
            <strong>注意：思考模式开启时这个值不生效。</strong>
          </p>
        </section>

        <section class="field">
          <div class="field__label"><span>思考模式</span></div>
          <div class="row row--wrap">
            <label v-for="opt in REASONING_OPTIONS" :key="opt.value" class="radio">
              <input v-model="draft.reasoning" type="radio" :value="opt.value" />
              <span>{{ opt.label }}</span>
            </label>
          </div>
          <p class="field__hint">{{ reasoningHint }}</p>
          <p class="field__hint">
            <strong>为什么默认关闭：</strong>官方文档写明 <code>reasoning_effort</code> 的
            <code>none</code> 关闭思考模式，而<strong>默认强度是 high</strong> —— 也就是说不动它的话，
            模型会先"想一遍"再翻译，白等时间、白花 token；而且「思考模式下 temperature 不生效」，
            你设的温度会被忽略。翻译这类任务用不上推理，关掉即可。
          </p>
        </section>

        <section class="field">
          <div class="field__label">触发方式</div>
          <div class="row">
            <label class="radio">
              <input v-model="draft.trigger" type="radio" value="auto" />
              <span>选中即翻</span>
            </label>
            <label class="radio">
              <input v-model="draft.trigger" type="radio" value="shortcut" />
              <span>选中后按 Ctrl+Enter 才翻</span>
            </label>
          </div>
        </section>

        <section v-if="draft.trigger === 'auto'" class="field">
          <label class="field__label" for="s-debounce">防抖（毫秒）</label>
          <input
            id="s-debounce"
            v-model.number="draft.debounceMs"
            class="input input--narrow"
            type="number"
            min="0"
            max="3000"
            step="50"
          />
          <p class="field__hint">拖选过程中会不断触发选区变化，防抖能避免每次都发请求烧额度。</p>
        </section>

        <section class="field">
          <label class="field__label" for="s-zoom">打开 PDF 时的缩放</label>
          <div class="row">
            <input
              id="s-zoom"
              v-model.number="draft.defaultZoom"
              class="input input--narrow"
              type="number"
              min="0.25"
              max="4"
              step="0.05"
            />
            <span class="field__hint field__hint--inline">倍（1.5 = 150%）</span>
          </div>
          <p class="field__hint">
            每次打开文件都回到这个大小，之后用工具栏的 ± 调整。也可以在 .env 里改 <code>DEFAULT_ZOOM</code>。
          </p>
        </section>

        <section class="field">
          <label class="field__label" for="s-output">全文翻译 PDF 保存目录</label>
          <input id="s-output" v-model.trim="draft.outputDir" class="input" placeholder="留空：用户目录下的 PDF译文 文件夹" spellcheck="false" />
          <p class="field__hint">可填本机绝对路径。目录不存在会自动创建；如果自定义位置不可写，自动退回用户目录下的 PDF译文 文件夹。实际保存路径会在翻译完成后显示。</p>
        </section>

        <section class="field">
          <div class="field__label">
            <span>划词翻译提示词</span>
            <button class="btn btn--sm" @click="restorePrompt">恢复默认</button>
          </div>
          <textarea v-model="draft.systemPrompt" class="textarea textarea--prompt" spellcheck="false" />
          <p class="field__hint">
            用于划词翻译。全文译本使用引擎自己的公式保护与翻译提示。
          </p>
        </section>

        <section class="field">
          <div class="field__label">
            <span>配置文件</span>
          </div>
          <p class="field__hint" style="margin-top: 0">
            <code data-config-path>{{ configFile || '（未能获取路径）' }}</code>
          </p>
          <p class="field__hint">
            配置以这个文件为准，优先级高于浏览器本地存储。手工编辑它同样生效
            （改完刷新页面即可）。
          </p>
        </section>

        <section class="field">
          <div class="field__label">诊断</div>
          <div class="row row--wrap">
            <button class="btn" :disabled="testState === 'testing'" @click="testConnection">
              {{ testState === 'testing' ? '测试中…' : '测试连接' }}
            </button>
            <button class="btn" @click="doClearCache">清空翻译缓存（{{ caches }} 条）</button>
            <button class="btn" @click="resetAll">恢复全部默认</button>
          </div>
          <p v-if="testMessage" class="test-result" :class="`test-result--${testState}`">
            {{ testMessage }}
          </p>
        </section>
      </div>

      <footer class="dialog__foot">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn--primary" @click="save">保存</button>
      </footer>
    </div>
  </div>
</template>
