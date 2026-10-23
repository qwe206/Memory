import { notify as toastr } from '../personal/notify.js';
import { trimPersonalPanel, bindPersonalHistoryActions } from '../personal/panel.js';
import { mountMemoryShell } from '../personal/shell.js';
import { openMemoryWorkspace } from '../personal/workspace.js';
import { applyPersonalFeaturePolicy } from '../personal/features.js';
import { extension_settings, renderExtensionTemplateAsync } from "/scripts/extensions.js";
import { extensionName, extensionBasePath, defaultSettings } from "../utils/settings.js";
import {
  checkAuthorization,
  displayExpiryInfo,
  pluginAuthStatus,
} from "../utils/auth.js";
import {
  updateUI,
  setAvailableModels,
  populateModelDropdown,
  applyUpdateIndicator,
} from "./state.js";
import { bindModalEvents } from "./bindings.js";
import { fetchModels } from "../core/api.js";
import registry from '../SL/module/ModuleRegistry.js';
import { registerAllModules } from '../SL/module/register-all.js';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;


async function loadSettings() {
  extension_settings[extensionName] = {
    ...defaultSettings,
    ...(extension_settings[extensionName] || {}),
  };


  applyPersonalFeaturePolicy(extension_settings[extensionName]);
  checkAuthorization();


  const autoLogin = localStorage.getItem("plugin_auto_login") === "true";
  console.log(
    `[Memory-调试] 授权状态: ${pluginAuthStatus.authorized}, 自动登录标志: ${autoLogin}`,
  );
  if (autoLogin && pluginAuthStatus.authorized) {
    console.log("[Memory] 检测到有效授权，将执行自动UI更新。");
  }

  $("#expiry_info").html(displayExpiryInfo());
  updateUI();

  if (pluginAuthStatus.authorized && extension_settings[extensionName].apiUrl) {
    const cachedModels = localStorage.getItem("cached_models_amily2");
    if (cachedModels) {
      const models = JSON.parse(cachedModels);
      console.log(`[Memory] 从缓存加载模型列表 (${models.length}个)`);
      setAvailableModels(models);
      populateModelDropdown();
    } else {
      toastr.info("正在自动加载模型列表...", "Memory");
      setTimeout(async () => {
        const models = await fetchModels();
        if (models.length > 0) {
          setAvailableModels(models);
          localStorage.setItem("cached_models_amily2", JSON.stringify(models));
          populateModelDropdown();
        }
      }, 500);
    }
  }
}

async function initializePanel(contentPanel, errorContainer) {
    if (contentPanel.data("initialized")) return;

    try {
        // 1. 加载主面板外壳
        const modalContent = await $.get(`${extensionFolderPath}/assets/memory-modal.html`);
        contentPanel.html(modalContent);
        const mainContainer = contentPanel.find('#amily2_chat_optimiser');

        if (mainContainer.length) {
            // 2. 注册所有模块 → 统一 init + mount
            registerAllModules();
            await registry.mountAll({
                baseUrl: extensionFolderPath + '/',
                root:    mainContainer[0],   // 所有模块挂载到此 DOM 元素下
            });
        }

        // 3. 主面板跨模块绑定（导航、授权、API provider 切换等）
        trimPersonalPanel(mainContainer[0]);
        bindModalEvents();
        bindPersonalHistoryActions(mainContainer[0]);

        // 4. 加载设置（模型列表等）
        await loadSettings();
        mountMemoryShell(mainContainer[0]);

        contentPanel.data("initialized", true);
        console.log("[Memory-重构] 模块注册式架构已就绪，已挂载模块:", registry.names().join(', '));
        applyUpdateIndicator();
    } catch (error) {
        console.error("[Memory-建设部] 紧急报告：加载模块化蓝图时发生意外:", error);
        const errorMessage = errorContainer
            ? '<p style="color:red; padding:10px; border:1px solid red; border-radius:5px;">紧急报告：在扩展区域加载Memory界面时发生错误。</p>'
            : '<p style="color:red; padding: 20px;">紧急报告：无法加载Memory界面。</p>';

        if (errorContainer) {
            errorContainer.append(errorMessage);
        } else {
            contentPanel.html(errorMessage);
        }
    }
}

export async function createDrawer() {
  const settings = extension_settings[extensionName];
  const location = settings.iconLocation || 'topbar'; 

  if (location === 'topbar') {
    if ($("#amily2_main_drawer").length > 0) return; 

    const amily2DrawerHtml = `
      <div id="amily2_main_drawer" class="drawer">
          <div class="drawer-toggle" data-drawer="amily2_drawer_content">
              <div id="amily2_drawer_icon" class="drawer-icon fa-solid fa-book fa-fw closedIcon interactable" title="Memory" aria-label="展开Memory" role="button" aria-controls="amily2_drawer_content" aria-expanded="false" tabindex="0"></div>
          </div>
          <div id="amily2_drawer_content" class="drawer-content closedDrawer">
          </div>
      </div>
    `;
    $("#sys-settings-button").after(amily2DrawerHtml);

    const contentPanel = $("#amily2_drawer_content");
    await initializePanel(contentPanel);

    contentPanel.hide();
    $('#amily2_main_drawer .drawer-toggle').on('click', event => {
        event.preventDefault(); event.stopPropagation(); openMemoryWorkspace();
    });
    $('#amily2_drawer_icon').on('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); openMemoryWorkspace();
        }
    });

  } else if (location === 'extensions') {
    if ($("#extensions_settings2 #amily2_chat_optimiser").length > 0) return; 
    const amilyFrameHtml = `
      <div id="amily2_extension_frame">
          <div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header">
                  <b><i class="fas fa-crown" style="color: #ffc107;"></i> Memory</b>
                  <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
              </div>
              <div class="inline-drawer-content" style="display: none;">
              </div>
          </div>
      </div>
    `;

    const frame = $(amilyFrameHtml);
    $('#extensions_settings2').append(frame);
    const contentPanel = frame.find('.inline-drawer-content');
    initializePanel(contentPanel, frame);
  }
}
