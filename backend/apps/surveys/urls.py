from django.urls import path

from .views import SurveyDetailView, SurveyListCreateView, SurveySyncView

urlpatterns = [
    path("", SurveyListCreateView.as_view(), name="survey-list-create"),
    path("sync/", SurveySyncView.as_view(), name="survey-sync"),
    path("<uuid:pk>/", SurveyDetailView.as_view(), name="survey-detail"),
]
