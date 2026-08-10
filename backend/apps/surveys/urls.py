from django.urls import path

from .views import SurveyDetailView, SurveyListCreateView

urlpatterns = [
    path("", SurveyListCreateView.as_view(), name="survey-list-create"),
    path("<uuid:pk>/", SurveyDetailView.as_view(), name="survey-detail"),
]
