#include "main_window.h"

#include <QDateTime>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QLocalServer>
#include <QLocalSocket>
#include <QPushButton>
#include <QTextBrowser>
#include <QVBoxLayout>
#include <QWidget>

#include "agent_core.h"
#include "gui_event_bus.h"

namespace {

QString htmlEscape(const QString& value) {
  return value.toHtmlEscaped().replace(QStringLiteral("\n"), QStringLiteral("<br>"));
}

QString itemLine(const QJsonObject& object) {
  const QString alias = object.value(QStringLiteral("alias")).toString();
  const QString name = object.value(QStringLiteral("name")).toString();
  const QString path = object.value(QStringLiteral("path")).toString();
  const QString label = !alias.isEmpty() ? alias : (!name.isEmpty() ? name : path);
  return QStringLiteral("<b>%1</b><br><span style='color:#64748b'>%2</span>")
      .arg(htmlEscape(label), htmlEscape(path));
}

}  // namespace

MainWindow::MainWindow(AgentCore& core, QWidget* parent) : QMainWindow(parent), core_(core) {
  buildUi();
  startEventServer();
  refreshMemoryStatus();

  appendMessage(QStringLiteral("Superpower"),
                QStringLiteral("Local Agent is ready. I can remember file locations, search approved folders, and open an approved result. Try: /find project-name"));
}

MainWindow::~MainWindow() {
  if (eventServer_) eventServer_->close();
  QLocalServer::removeServer(superpowerGuiEventServerName());
}

void MainWindow::buildUi() {
  setWindowTitle(QStringLiteral("Superpower Local Agent"));
  resize(720, 760);
  setMinimumSize(520, 520);

  auto* central = new QWidget(this);
  auto* root = new QVBoxLayout(central);
  root->setContentsMargins(16, 16, 16, 16);
  root->setSpacing(10);

  auto* titleRow = new QHBoxLayout();
  auto* title = new QLabel(QStringLiteral("<b>Superpower Local Agent</b>"), central);
  statusLabel_ = new QLabel(central);
  statusLabel_->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
  titleRow->addWidget(title);
  titleRow->addStretch(1);
  titleRow->addWidget(statusLabel_);
  root->addLayout(titleRow);

  auto* actionRow = new QHBoxLayout();
  auto* rememberButton = new QPushButton(QStringLiteral("Remember folder"), central);
  auto* rootButton = new QPushButton(QStringLiteral("Add search root"), central);
  auto* helpLabel = new QLabel(QStringLiteral("Local-only memory · no full-disk scan"), central);
  helpLabel->setStyleSheet(QStringLiteral("color:#64748b;"));
  actionRow->addWidget(rememberButton);
  actionRow->addWidget(rootButton);
  actionRow->addStretch(1);
  actionRow->addWidget(helpLabel);
  root->addLayout(actionRow);

  transcript_ = new QTextBrowser(central);
  transcript_->setOpenExternalLinks(false);
  transcript_->setStyleSheet(QStringLiteral(
      "QTextBrowser { border:1px solid #dbe3ea; border-radius:10px; background:#fbfdff; padding:8px; }"));
  root->addWidget(transcript_, 1);

  auto* composer = new QHBoxLayout();
  input_ = new QLineEdit(central);
  input_->setPlaceholderText(QStringLiteral("Ask local memory… e.g. /find catalyst project"));
  input_->setClearButtonEnabled(true);
  auto* sendButton = new QPushButton(QStringLiteral("Send"), central);
  sendButton->setDefault(true);
  composer->addWidget(input_, 1);
  composer->addWidget(sendButton);
  root->addLayout(composer);

  auto* hint = new QLabel(
      QStringLiteral("Commands: /remember alias = path · /find query · /open query · /root path · /list"), central);
  hint->setWordWrap(true);
  hint->setStyleSheet(QStringLiteral("color:#64748b; font-size:11px;"));
  root->addWidget(hint);

  setCentralWidget(central);

  connect(sendButton, &QPushButton::clicked, this, [this]() { handleUserMessage(); });
  connect(input_, &QLineEdit::returnPressed, this, [this]() { handleUserMessage(); });
  connect(rememberButton, &QPushButton::clicked, this, [this]() { rememberFolder(); });
  connect(rootButton, &QPushButton::clicked, this, [this]() { addSearchRoot(); });
}

void MainWindow::startEventServer() {
  QLocalServer::removeServer(superpowerGuiEventServerName());
  eventServer_ = new QLocalServer(this);
  if (!eventServer_->listen(superpowerGuiEventServerName())) {
    appendMessage(QStringLiteral("System"), QStringLiteral("Browser activity bridge could not start: %1").arg(eventServer_->errorString()),
                  QStringLiteral("warning"));
    return;
  }

  connect(eventServer_, &QLocalServer::newConnection, this, [this]() {
    while (eventServer_->hasPendingConnections()) {
      QLocalSocket* socket = eventServer_->nextPendingConnection();
      connect(socket, &QLocalSocket::readyRead, this, [this, socket]() {
        while (socket->canReadLine()) {
          const QByteArray line = socket->readLine().trimmed();
          if (line.isEmpty()) continue;
          QJsonParseError error;
          const QJsonDocument document = QJsonDocument::fromJson(line, &error);
          if (error.error == QJsonParseError::NoError && document.isObject()) {
            renderBrowserEvent(document.object());
          }
        }
      });
      connect(socket, &QLocalSocket::disconnected, socket, &QObject::deleteLater);
    }
  });
}

void MainWindow::appendMessage(const QString& role, const QString& text, const QString& tone) {
  QString accent = QStringLiteral("#0f172a");
  if (tone == QStringLiteral("warning")) accent = QStringLiteral("#b45309");
  if (tone == QStringLiteral("success")) accent = QStringLiteral("#047857");
  if (role == QStringLiteral("You")) accent = QStringLiteral("#1d4ed8");

  const QString timestamp = QDateTime::currentDateTime().toString(QStringLiteral("HH:mm"));
  transcript_->append(QStringLiteral(
                          "<div style='margin:7px 2px 11px 2px'>"
                          "<div style='font-size:11px;color:%1'><b>%2</b> · %3</div>"
                          "<div style='margin-top:3px;line-height:1.45'>%4</div>"
                          "</div>")
                          .arg(accent, htmlEscape(role), htmlEscape(timestamp), text));
  transcript_->verticalScrollBar()->setValue(transcript_->verticalScrollBar()->maximum());
}

QJsonObject MainWindow::requestForText(const QString& text) const {
  const QString clean = text.trimmed();
  QJsonObject request{{QStringLiteral("id"), QStringLiteral("gui-%1").arg(requestCounter_ + 1)}};
  QJsonObject args;

  if (clean.startsWith(QStringLiteral("/remember "), Qt::CaseInsensitive)) {
    const QString payload = clean.mid(10).trimmed();
    const qsizetype separator = payload.indexOf(QLatin1Char('='));
    if (separator > 0) {
      request.insert(QStringLiteral("action"), QStringLiteral("memory.remember"));
      args.insert(QStringLiteral("alias"), payload.left(separator).trimmed());
      args.insert(QStringLiteral("path"), payload.mid(separator + 1).trimmed());
      args.insert(QStringLiteral("approved"), true);
    }
  } else if (clean.startsWith(QStringLiteral("/find "), Qt::CaseInsensitive)) {
    request.insert(QStringLiteral("action"), QStringLiteral("file.search"));
    args.insert(QStringLiteral("query"), clean.mid(6).trimmed());
  } else if (clean.startsWith(QStringLiteral("/open "), Qt::CaseInsensitive)) {
    request.insert(QStringLiteral("action"), QStringLiteral("file.open"));
    args.insert(QStringLiteral("query"), clean.mid(6).trimmed());
    args.insert(QStringLiteral("approved"), true);
  } else if (clean.startsWith(QStringLiteral("/root "), Qt::CaseInsensitive)) {
    request.insert(QStringLiteral("action"), QStringLiteral("memory.add_root"));
    args.insert(QStringLiteral("path"), clean.mid(6).trimmed());
    args.insert(QStringLiteral("recursive"), true);
    args.insert(QStringLiteral("approved"), true);
  } else if (clean.compare(QStringLiteral("/list"), Qt::CaseInsensitive) == 0) {
    request.insert(QStringLiteral("action"), QStringLiteral("memory.list"));
  } else {
    request.insert(QStringLiteral("action"), QStringLiteral("memory.resolve"));
    args.insert(QStringLiteral("query"), clean);
  }

  if (!args.isEmpty()) request.insert(QStringLiteral("args"), args);
  return request;
}

void MainWindow::handleUserMessage() {
  const QString text = input_->text().trimmed();
  if (text.isEmpty()) return;
  input_->clear();
  ++requestCounter_;

  appendMessage(QStringLiteral("You"), htmlEscape(text));
  QJsonObject request = requestForText(text);
  request.insert(QStringLiteral("id"), QStringLiteral("gui-%1").arg(requestCounter_));
  if (!request.contains(QStringLiteral("action"))) {
    appendMessage(QStringLiteral("Superpower"),
                  QStringLiteral("Use /remember alias = path, /find query, /open query, /root path, or /list."),
                  QStringLiteral("warning"));
    return;
  }

  renderAgentResponse(core_.handle(request));
  refreshMemoryStatus();
}

void MainWindow::rememberFolder() {
  const QString path = QFileDialog::getExistingDirectory(this, QStringLiteral("Remember a folder"));
  if (path.isEmpty()) return;

  const QString suggested = QFileInfo(path).fileName();
  bool accepted = false;
  const QString alias = QInputDialog::getText(this, QStringLiteral("Location alias"),
                                               QStringLiteral("How should Superpower remember this folder?"),
                                               QLineEdit::Normal, suggested, &accepted)
                            .trimmed();
  if (!accepted || alias.isEmpty()) return;

  const QJsonObject request{{QStringLiteral("id"), QStringLiteral("gui-%1").arg(++requestCounter_)},
                            {QStringLiteral("action"), QStringLiteral("memory.remember")},
                            {QStringLiteral("args"), QJsonObject{{QStringLiteral("alias"), alias},
                                                                 {QStringLiteral("path"), path},
                                                                 {QStringLiteral("approved"), true}}}};
  renderAgentResponse(core_.handle(request));
  refreshMemoryStatus();
}

void MainWindow::addSearchRoot() {
  const QString path = QFileDialog::getExistingDirectory(this, QStringLiteral("Add an approved search root"));
  if (path.isEmpty()) return;

  const QJsonObject request{{QStringLiteral("id"), QStringLiteral("gui-%1").arg(++requestCounter_)},
                            {QStringLiteral("action"), QStringLiteral("memory.add_root")},
                            {QStringLiteral("args"), QJsonObject{{QStringLiteral("path"), path},
                                                                 {QStringLiteral("label"), QFileInfo(path).fileName()},
                                                                 {QStringLiteral("recursive"), true},
                                                                 {QStringLiteral("approved"), true}}}};
  renderAgentResponse(core_.handle(request));
  refreshMemoryStatus();
}

void MainWindow::renderAgentResponse(const QJsonObject& response) {
  if (!response.value(QStringLiteral("ok")).toBool(false)) {
    const QJsonObject error = response.value(QStringLiteral("error")).toObject();
    appendMessage(QStringLiteral("Superpower"), htmlEscape(error.value(QStringLiteral("message")).toString()),
                  QStringLiteral("warning"));
    return;
  }

  const QJsonValue resultValue = response.value(QStringLiteral("result"));
  const QJsonObject result = resultValue.toObject();
  if (result.contains(QStringLiteral("path"))) {
    appendMessage(QStringLiteral("Superpower"), itemLine(result), QStringLiteral("success"));
    return;
  }

  auto renderArray = [this](const QJsonArray& items, const QString& emptyMessage) {
    if (items.isEmpty()) {
      appendMessage(QStringLiteral("Superpower"), htmlEscape(emptyMessage));
      return;
    }
    QStringList lines;
    for (const QJsonValue& value : items) lines.push_back(itemLine(value.toObject()));
    appendMessage(QStringLiteral("Superpower"), lines.join(QStringLiteral("<hr style='border:none;border-top:1px solid #e2e8f0'>")));
  };

  if (result.contains(QStringLiteral("matches"))) {
    renderArray(result.value(QStringLiteral("matches")).toArray(), QStringLiteral("No matching files were found in approved locations."));
    return;
  }
  if (result.contains(QStringLiteral("locations"))) {
    renderArray(result.value(QStringLiteral("locations")).toArray(), QStringLiteral("No locations have been remembered yet."));
    return;
  }
  if (result.contains(QStringLiteral("roots"))) {
    const QJsonArray roots = result.value(QStringLiteral("roots")).toArray();
    if (roots.isEmpty()) {
      appendMessage(QStringLiteral("Superpower"), QStringLiteral("No search roots are approved yet."));
      return;
    }
    QStringList lines;
    for (const QJsonValue& value : roots) {
      const QJsonObject root = value.toObject();
      lines.push_back(QStringLiteral("<b>%1</b><br><span style='color:#64748b'>%2</span>")
                          .arg(htmlEscape(root.value(QStringLiteral("label")).toString().isEmpty()
                                              ? QStringLiteral("Search root")
                                              : root.value(QStringLiteral("label")).toString()),
                               htmlEscape(root.value(QStringLiteral("path")).toString())));
    }
    appendMessage(QStringLiteral("Superpower"), lines.join(QStringLiteral("<hr style='border:none;border-top:1px solid #e2e8f0'>")));
    return;
  }

  appendMessage(QStringLiteral("Superpower"), htmlEscape(QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact))));
}

void MainWindow::renderBrowserEvent(const QJsonObject& event) {
  const QString action = event.value(QStringLiteral("action")).toString();
  const bool ok = event.value(QStringLiteral("ok")).toBool(false);
  QString text = QStringLiteral("Browser requested <b>%1</b> — %2")
                     .arg(htmlEscape(action), ok ? QStringLiteral("completed") : QStringLiteral("failed"));
  if (event.contains(QStringLiteral("path"))) {
    text += QStringLiteral("<br><span style='color:#64748b'>%1</span>")
                .arg(htmlEscape(event.value(QStringLiteral("path")).toString()));
  }
  if (event.contains(QStringLiteral("message"))) {
    text += QStringLiteral("<br>%1").arg(htmlEscape(event.value(QStringLiteral("message")).toString()));
  }
  appendMessage(QStringLiteral("Browser"), text, ok ? QStringLiteral("success") : QStringLiteral("warning"));
  refreshMemoryStatus();
}

void MainWindow::refreshMemoryStatus() {
  QString error;
  const int locations = core_.memoryStore().listLocations(500, &error).size();
  const int roots = core_.memoryStore().listSearchRoots(&error).size();
  statusLabel_->setText(QStringLiteral("%1 memories · %2 roots").arg(locations).arg(roots));
  statusLabel_->setStyleSheet(error.isEmpty() ? QStringLiteral("color:#475569;") : QStringLiteral("color:#b45309;"));
}
