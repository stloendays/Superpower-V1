#pragma once

#include <QJsonObject>
#include <QMainWindow>

class AgentCore;
class QLabel;
class QLineEdit;
class QLocalServer;
class QTextBrowser;

class MainWindow final : public QMainWindow {
  Q_OBJECT

 public:
  explicit MainWindow(AgentCore& core, QWidget* parent = nullptr);
  ~MainWindow() override;

 private:
  void buildUi();
  void startEventServer();
  void handleUserMessage();
  void rememberFolder();
  void addSearchRoot();
  void appendMessage(const QString& role, const QString& text, const QString& tone = QStringLiteral("normal"));
  void renderAgentResponse(const QJsonObject& response);
  void renderBrowserEvent(const QJsonObject& event);
  void refreshMemoryStatus();
  QJsonObject requestForText(const QString& text) const;

  AgentCore& core_;
  QTextBrowser* transcript_ = nullptr;
  QLineEdit* input_ = nullptr;
  QLabel* statusLabel_ = nullptr;
  QLocalServer* eventServer_ = nullptr;
  quint64 requestCounter_ = 0;
};
