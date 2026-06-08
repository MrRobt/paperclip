import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

type AppErrorBoundaryCopy = {
  title: string;
  description: string;
};

function getAppErrorBoundaryCopy(error: Error): AppErrorBoundaryCopy {
  const message = error.message.toLowerCase();
  if (message.includes("403") || message.includes("forbidden") || message.includes("unauthorized") || message.includes("permission")) {
    return {
      title: "无权限访问当前公司页面",
      description: "请切换公司或联系管理员开通权限，系统已拦截空白页。",
    };
  }
  if (message.includes("archived") || message.includes("归档") || message.includes("readonly") || message.includes("read-only")) {
    return {
      title: "公司已归档",
      description: "当前公司处于只读归档状态，可从公司列表或切换器进入查看。",
    };
  }
  if (message.includes("404") || message.includes("not found") || message.includes("不存在")) {
    return {
      title: "公司或页面不存在",
      description: "请确认公司前缀和页面地址是否正确，或返回公司列表重新进入。",
    };
  }
  if (message.includes("network") || message.includes("failed") || message.includes("timeout") || message.includes("接口")) {
    return {
      title: "接口加载失败",
      description: "当前公司页面接口请求失败，请稍后刷新，或切换到公司列表重新进入。",
    };
  }
  return {
    title: "页面加载失败",
    description: "当前公司页面渲染异常，已拦截空白页。请刷新重试，或切换到公司列表重新进入。",
  };
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Paperclip route render failed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const copy = getAppErrorBoundaryCopy(this.state.error);

    return (
      <div className="mx-auto max-w-2xl py-10">
        <div className="rounded-lg border border-destructive/30 bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">页面加载失败</div>
              <h1 className="mt-1 text-xl font-semibold">{copy.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.description}
              </p>
              <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                错误信息：<code className="break-all font-mono">{this.state.error.message || "未知错误"}</code>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => window.location.reload()}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  刷新页面
                </Button>
                <Button variant="outline" onClick={() => { window.location.href = "/companies"; }}>
                  打开公司列表
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
