// @Entity
export default class SystemConfig {
  // HTTP service port, IP and path prefix
  httpPort: number = 23333;
  httpIp: string = "";
  prefix: string = "";

  // reverse proxy mode
  reverseProxyMode: boolean = false;
  // reverse proxy header
  reverseProxyHeader: string = "X-Real-IP";

  // data transfer port
  dataPort: number = 23334;

  // Distributed forwarding mode
  forwardType: number = 1;

  // Whether to allow cross-domain requests
  crossDomain: boolean = false;

  // Whether to use Gzip compression for HTTP return information
  gzip: boolean = false;

  // Maximum simultaneous compression tasks
  maxCompress: number = 1;

  // Maximum simultaneous download tasks
  maxDownload: number = 10;

  // Decompression implementation form
  zipType: number = 1;

  // TOTP drift tolerance, in steps (30 seconds)
  totpDriftToleranceSteps: number = 0;

  // Login times IP limit
  loginCheckIp: boolean = true;

  // login Copyright Information
  loginInfo: string = "";

  // Whether to open the file management function for ordinary users
  canFileManager = true;

  // Whether to allow template-based instance reset, which may pose a security risk.
  // If you use Docker and need commercial functionality, you can try turning this feature on and testing it.
  allowUsePreset = false;

  // Panel display language
  language = "en_us";

  // Quick installation address
  presetPackAddr = "https://script.mcsmanager.com/market-v2.json";

  // Legacy only. The update checker now always uses the built-in GitHub latest API.
  updateReleaseApiUrl = "https://api.github.com/repos/zerogzy/MCSManager/releases/latest";

  // GitHub download proxy prefix, for example: https://v4.gh-proxy.org/https://github.com/...
  updateDownloadProxyUrl = "";

  // Legacy only. Update restart commands are built in.
  updateServiceRestartCommand = "systemctl restart mcsm-web mcsm-daemon";

  // Legacy only. Prerelease releases are no longer exposed as a user setting.
  updateAllowPrerelease = false;

  // Redis address (Experimental Features)
  redisUrl = "";

  // Whether to allow users to edit the start & update command of Docker instances
  allowChangeCmd = false;

  // Whether API key authentication is enabled for the panel.
  enableApiKey = false;

  // -----
  // After it is enabled, you can connect to the redeem.mcsmanager.com platform
  // to sell instances based on redeem
  // (this feature may not be available in some countries)
  businessMode = false;
  businessId = "";
  panelId = "";
  registerCode = "";
  // -----

  // SSO / OpenID Connect / OAuth 2.0
  ssoEnabled = false;
  ssoType: "oidc" | "oauth2" = "oidc";
  ssoOnlyMode = false;
  ssoAutoRedirect = false;
  ssoProviderName = "";
  ssoIconUrl = "";
  // OIDC-specific
  ssoIssuer = "";
  // OAuth 2.0-specific
  ssoAuthorizeUrl = "";
  ssoTokenUrl = "";
  ssoUserinfoUrl = "";
  ssoUserIdField = "id";
  ssoScopes = "";
  // Shared
  ssoClientId = "";
  ssoClientSecret = "";
  ssoCallbackUrl = "";

  // -----
  // 商城 / 支付配置（虎皮椒）
  payAppId = "";
  payAppSecret = "";
  payGatewayUrl = "https://api.xunhupay.com/payment/do.html";
  payBackupUrl = "https://api.dpweixin.com/payment/do.html";
  payNotifyUrl = "";
  // -----

  // Whether to enable SSL/TLS (HTTPS)
  ssl = false;
  // SSL certificate file path (.pem)
  sslPemPath = "";
  // SSL private key file path (.key)
  sslKeyPath = "";
}
